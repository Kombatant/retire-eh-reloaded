import type { AccountV2, ExpenseItem, GrowthRule, IncomeStream, PlanV2, TimePoint } from '@/lib/plan/schema'
import { TAX_2026 } from '@/lib/tax/data/2026'
import { resolveYear } from '@/lib/plan/time'
import { cppAmountAt65, primarySalary } from '@/lib/plan/legacy-view'
import type { CompiledAccount, CompiledDebt, CompiledExpense, CompiledFlow, CompiledIncome, CompiledPerson, CompiledPhase, CompiledPlan, CompiledProperty, RuleSet } from './types'

const TAXABLE_ACCOUNT_TYPES = new Set(['RRSP', 'RRIF', 'LIRA', 'LIF', 'FHSA'])
const DEDUCTIBLE_ACCOUNT_TYPES = new Set(['RRSP', 'FHSA'])
const NO_YIELDS = { interest: 0, eligibleDividends: 0, foreignDividends: 0 }

function accountAllocation(a: AccountV2): CompiledAccount['allocation'] {
  if (a.returnOverridePct !== undefined) return null
  if (a.allocation) {
    const total = a.allocation.equity + a.allocation.bond + a.allocation.cash
    if (total > 0) return { equity: a.allocation.equity / total, bond: a.allocation.bond / total, cash: a.allocation.cash / total }
  }
  if (a.type === 'CASH') return { equity: 0, bond: 0, cash: 1 }
  return null
}

function accountExpectedReturn(a: AccountV2, plan: PlanV2): number {
  if (a.returnOverridePct !== undefined) return a.returnOverridePct
  if (a.allocation) {
    const r = plan.assumptions.assetReturns
    const total = a.allocation.equity + a.allocation.bond + a.allocation.cash
    if (total > 0) {
      return (a.allocation.equity * r.equityPct + a.allocation.bond * r.bondPct + a.allocation.cash * r.cashPct) / total
    }
  }
  if (a.type === 'CASH') return plan.assumptions.assetReturns.cashPct
  return plan.assumptions.expectedReturn
}

export interface CompileOptions {
  startYear: number
  rules?: RuleSet
}

// Resolve everything that does not depend on the market path once, so Monte
// Carlo and backtests can re-run `simulate` cheaply on the same plan.
export function compilePlan(plan: PlanV2, { startYear, rules = 'v2' }: CompileOptions): CompiledPlan {
  const offsetOf = (point: TimePoint | undefined, fallback: number) =>
    resolveYear(point, plan.people, startYear, startYear + fallback) - startYear

  const people: CompiledPerson[] = plan.people.map(p => ({
    id: p.id,
    name: p.name,
    birthYear: p.birthYear,
    retirementOffset: p.birthYear + p.retirementAge - startYear,
    endOffset: p.birthYear + p.lifeExpectancy - startYear,
    cppAt65: cppAmountAt65(p, primarySalary(plan, p.id)),
    cppStartAge: p.cppStartAge,
    oasStartAge: p.oas.startAge,
    province: p.province,
    yearsInCanadaAfter18: p.oas.yearsInCanadaAfter18,
    rrspRoom: p.room?.rrsp,
    tfsaRoom: p.room?.tfsa,
  }))
  const personIndex = new Map(people.map((p, i) => [p.id, i]))

  const drawdownStartOffset = Math.max(0, ...people.map(p => p.retirementOffset))
  // Run until the last person reaches their life expectancy, and always at
  // least through the first drawdown year.
  const lastOffset = Math.max(drawdownStartOffset, ...people.map(p => p.endOffset))
  const years = lastOffset + 1

  const growthFlow = (
    amount: number,
    startOffset: number,
    endOffset: number,
    growth: GrowthRule,
    everyN = 1,
  ): CompiledFlow => ({
    startOffset,
    endOffset,
    amount,
    basis: growth.kind === 'cpi' ? 'real' : 'nominal',
    ratePct: growth.kind === 'none' ? 0 : growth.pct,
    everyN,
  })

  const customOrder = plan.drawdown.customOrder
  const orderRank = (type: AccountV2['type']) => {
    const i = customOrder.indexOf(type)
    return i < 0 ? customOrder.length : i
  }

  const accounts: CompiledAccount[] = plan.accounts.map(a => {
    const owner = personIndex.get(a.ownerId) ?? -1
    const ownerRetirement = owner >= 0 ? people[owner].retirementOffset : drawdownStartOffset
    return {
      id: a.id,
      type: a.type,
      ownerIndex: owner,
      taxable: TAXABLE_ACCOUNT_TYPES.has(a.type),
      initialBalance: a.balance,
      contributions: a.contributions.map(c => growthFlow(
        c.amount,
        Math.max(0, offsetOf(c.from, 0)),
        offsetOf(c.to, ownerRetirement),
        c.indexed ? { kind: 'cpi', pct: 0 } : { kind: 'none', pct: 0 },
      )),
      synthetic: false,
      expectedReturnPct: rules === 'v1' ? plan.assumptions.expectedReturn : accountExpectedReturn(a, plan),
      nonRegistered: rules === 'v2' && (a.type === 'NONREG' || a.type === 'CASH'),
      deductible: DEDUCTIBLE_ACCOUNT_TYPES.has(a.type),
      initialAcb: a.type === 'NONREG' ? (a.acb ?? a.balance) : a.balance,
      yields: a.type === 'NONREG' && a.yields
        ? {
            interest: a.yields.interestPct / 100,
            eligibleDividends: a.yields.eligibleDividendPct / 100,
            foreignDividends: a.yields.foreignDividendPct / 100,
          }
        : NO_YIELDS,
      interestOnly: a.type === 'CASH',
      lifetimeRoom: a.type === 'FHSA' ? Math.max(0, TAX_2026.limits.fhsaLifetime - a.lifetimeContributed) : Infinity,
      orderRank: orderRank(a.type),
      allocation: accountAllocation(a),
      stock: null,
    }
  })

  // Stock portfolios: holdings with their own price paths, RSU vesting, ESPP
  // purchases and a sell plan. Balance and cost base come from the holdings.
  let holdingCount = 0
  const scenario = plan.assumptions.stockScenario
  const usdCad = plan.assumptions.usdCad.rate
  plan.accounts.forEach((a, i) => {
    if (a.type !== 'STOCK') return
    const acct = accounts[i]
    const owner = acct.ownerIndex
    const ownerRetirement = owner >= 0 ? people[owner].retirementOffset : drawdownStartOffset
    // Share prices are entered in USD; the engine works in CAD at a constant rate.
    const holdings = a.holdings.map(h => ({
      index: holdingCount++,
      symbol: h.symbol,
      shares: h.shares,
      price: h.priceUsd * usdCad,
      acb: h.shares * (h.costPerShare ?? h.priceUsd * usdCad),
      growth: h.growthPct[scenario] / 100,
      dividendYield: h.dividendYieldPct / 100,
      dividendEligible: h.dividendType === 'eligible',
      volatility: h.volatilityPct / 100,
      grants: h.rsuGrants.map(g => ({ offset: offsetOf(g.vestAt, 0), shares: g.shares })).filter(g => g.offset >= 0 && g.shares > 0),
      sellToCover: h.sellToCover,
      espp: h.espp && h.espp.annualContribution > 0
        ? {
            flow: growthFlow(
              h.espp.annualContribution,
              Math.max(0, offsetOf(h.espp.from, 0)),
              offsetOf(h.espp.to, ownerRetirement),
              h.espp.indexed ? { kind: 'cpi', pct: 0 } : { kind: 'none', pct: 0 },
            ),
            discount: h.espp.discountPct / 100,
            match: h.espp.employerMatchPct / 100,
          }
        : null,
    }))
    const value = holdings.reduce((s, h) => s + h.shares * h.price, 0)
    const sale = a.salePlan
    acct.initialBalance = value
    acct.initialAcb = holdings.reduce((s, h) => s + h.acb, 0)
    acct.nonRegistered = rules === 'v2'
    acct.expectedReturnPct = value > 0
      ? holdings.reduce((s, h) => s + h.shares * h.price * (h.growth + h.dividendYield), 0) / value * 100
      : plan.assumptions.expectedReturn
    acct.stock = {
      holdings,
      sale: {
        kind: rules === 'v2' ? sale.kind : 'none',
        amount: sale.kind === 'fixedAmount' ? sale.amount : 0,
        // Selling to fund retirement starts when the household retires unless set.
        startOffset: sale.kind === 'none' ? 0 : Math.max(0, offsetOf(sale.from, drawdownStartOffset)),
        endOffset: sale.kind === 'none' ? 0 : offsetOf(sale.to, years),
      },
    }
  })

  const syntheticAccount = (id: string, type: 'TFSA' | 'NONREG', ownerIndex: number): CompiledAccount => ({
    id, type, ownerIndex, taxable: false, initialBalance: 0, contributions: [], synthetic: true,
    expectedReturnPct: plan.assumptions.expectedReturn, nonRegistered: type === 'NONREG' && rules === 'v2',
    deductible: false, initialAcb: 0, yields: NO_YIELDS, interestOnly: false, lifetimeRoom: Infinity,
    orderRank: orderRank(type),
    allocation: null,
    stock: null,
  })

  // Reinvested RRSP refunds are after-tax cash, so they land in the owner's
  // TFSA. People without a TFSA get a synthetic one to receive them.
  // v1 used a flat marginal rate; v2 computes the refund with the tax engine.
  const refundTargets = people.map(() => -1)
  if (plan.assumptions.reinvestRrspRefund) {
    const flatRate = plan.assumptions.workingMarginalTaxRate / 100
    people.forEach((person, idx) => {
      // v1 only refunded RRSP contributions; v2 also refunds deductible FHSA ones.
      const rrspFlows = accounts
        .filter(a => a.ownerIndex === idx && (rules === 'v1' ? a.type === 'RRSP' : a.deductible))
        .flatMap(a => a.contributions)
        .filter(flow => flow.amount > 0)
      if (rrspFlows.length === 0) return
      if (rules === 'v1' && flatRate <= 0) return
      let targetIndex = accounts.findIndex(a => a.ownerIndex === idx && a.type === 'TFSA')
      if (targetIndex < 0) {
        accounts.push(syntheticAccount(`${person.id}-refund-tfsa`, 'TFSA', idx))
        targetIndex = accounts.length - 1
      }
      if (rules === 'v1') {
        accounts[targetIndex].contributions.push(...rrspFlows.map(flow => ({ ...flow, amount: flow.amount * flatRate })))
      } else {
        refundTargets[idx] = targetIndex
      }
    })
  }

  // One-time receipts (inheritances, bonuses) are invested in the owner's
  // non-registered account, created if needed.
  const depositAccountFor = (owner: number): number => {
    let index = accounts.findIndex(a => a.ownerIndex === owner && a.type === 'NONREG')
    if (index < 0) {
      accounts.push(syntheticAccount(`${people[owner].id}-windfalls`, 'NONREG', owner))
      index = accounts.length - 1
    }
    return index
  }

  // Where an RSU bonus lands: the chosen holding if this person owns it, else
  // their first stock holding, else their non-registered account.
  const rsuTarget = (stream: IncomeStream, owner: number): NonNullable<CompiledIncome['rsu']> => {
    const owned = plan.accounts.flatMap((a, account) => (
      a.type === 'STOCK' && accounts[account].ownerIndex === owner
        ? a.holdings.map((h, i) => ({ id: h.id, account, holding: accounts[account].stock!.holdings[i].index }))
        : []
    ))
    const target = owned.find(h => h.id === stream.rsu?.holdingId) ?? owned[0]
    return {
      incomeId: stream.id,
      account: target?.account ?? depositAccountFor(owner),
      holding: target?.holding ?? -1,
      sellToCover: stream.rsu?.sellToCover ?? true,
    }
  }

  const incomes: CompiledIncome[] = plan.incomes.flatMap(stream => {
    const owner = personIndex.get(stream.ownerId)
    if (owner === undefined) return []
    const flow = incomeFlow(stream, offsetOf, years)
    const isRsu = stream.kind === 'rsu' && rules === 'v2'
    const deposit = rules === 'v2' && stream.frequency === 'oneTime' && !isRsu ? depositAccountFor(owner) : -1
    const survivorFraction = stream.kind === 'dbPension' && rules === 'v2' ? (stream.db?.survivorPct ?? 60) / 100 : 0
    const compiled: CompiledIncome[] = [{
      personIndex: owner, kind: stream.kind, taxTreatment: stream.taxTreatment, flow, depositAccount: deposit, survivorFraction,
      rsu: isRsu ? rsuTarget(stream, owner) : undefined,
    }]
    // A DB bridge benefit is paid on top of the lifetime pension until the
    // bridge end age (usually 65, when CPP/OAS start).
    const bridge = stream.kind === 'dbPension' ? stream.db?.bridge : undefined
    if (rules === 'v2' && bridge && bridge.amount > 0) {
      const bridgeEnd = people[owner].birthYear + bridge.untilAge - startYear
      compiled.push({
        personIndex: owner, kind: 'dbPension', taxTreatment: stream.taxTreatment, depositAccount: -1, survivorFraction: 0,
        flow: { ...flow, amount: bridge.amount, endOffset: Math.min(flow.endOffset, bridgeEnd), indexFracInPayment: flow.indexFracInPayment },
      })
    }
    return compiled
  })

  const expenses: CompiledExpense[] = plan.expenses.items.map(item => ({
    id: item.id,
    category: item.category,
    essential: item.essential,
    oneTime: item.frequency === 'oneTime',
    flow: expenseFlow(item, offsetOf, years),
  }))

  const phases: CompiledPhase[] = plan.expenses.phases.map(ph => ({
    startOffset: offsetOf(ph.from, 0),
    endOffset: offsetOf(ph.to, years),
    multiplier: ph.discretionaryMultiplierPct / 100,
  }))

  const properties: CompiledProperty[] = plan.properties.map(pr => {
    const owner = personIndex.get(pr.ownerId) ?? -1
    const saleOffset = pr.sale ? offsetOf(pr.sale.at, -1) : -1
    return {
      ownerIndex: owner,
      value: pr.value,
      appreciationReal: pr.appreciationRealPct / 100,
      principalResidence: pr.isPrincipalResidence,
      acb: pr.acb ?? pr.value,
      annualCosts: pr.annualCosts,
      saleOffset: saleOffset >= 0 && saleOffset < years ? saleOffset : -1,
      sellingCost: (pr.sale?.sellingCostPct ?? 0) / 100,
      replacementValue: pr.sale?.replacementValue ?? 0,
      // Joint homes put proceeds in the first person's account.
      proceedsAccount: pr.sale && rules === 'v2' ? depositAccountFor(owner >= 0 ? owner : 0) : -1,
    }
  })
  const propertyIndex = new Map(plan.properties.map((pr, i) => [pr.id, i]))
  const debts: CompiledDebt[] = plan.debts.map(d => ({
    balance: d.balance,
    annualRate: d.interestRatePct / 100,
    monthlyPayment: d.monthlyPayment,
    propertyIndex: d.propertyId ? (propertyIndex.get(d.propertyId) ?? -1) : -1,
  }))

  const detailed = plan.expenses.mode === 'detailed'
  const savingsAccount = rules === 'v2' && detailed && plan.expenses.surplusPolicy === 'save' && people.length > 0
    ? depositAccountFor(0)
    : -1

  // Simple-mode income target: replacement % of each person's primary
  // salary in its final year, in plan-start dollars.
  const inflation = plan.assumptions.inflationRate / 100
  const finalSalaries = people.reduce((total, _person, idx) => {
    const stream = incomes.find(i => i.personIndex === idx && i.kind === 'employment' && i.flow.everyN === 1 && i.flow.endOffset - i.flow.startOffset > 1)
    if (!stream) return total
    const n = Math.max(0, Math.min(stream.flow.endOffset, years) - 1)
    const grown = stream.flow.amount * Math.pow(1 + stream.flow.ratePct / 100, n)
    return total + (stream.flow.basis === 'real' ? grown : grown / Math.pow(1 + inflation, n))
  }, 0)

  // Forced RRIF/LIF minimums and stock sell plans can raise cash that is not
  // needed for spending; it is reinvested in a non-registered account.
  const hasRegistered = accounts.some(a => a.taxable || a.stock)
  const reinvestAccount = rules === 'v2' && hasRegistered && people.length > 0 ? depositAccountFor(0) : -1

  const strategy = plan.drawdown.strategy
  return {
    rules,
    startYear,
    years,
    drawdownStartOffset,
    people,
    accounts,
    holdingCount,
    incomes,
    expenses,
    expenseMode: rules === 'v2' ? plan.expenses.mode : 'simple',
    replacementRate: plan.expenses.replacementRate / 100,
    surplusPolicy: plan.expenses.surplusPolicy,
    phases,
    properties: rules === 'v2' ? properties : [],
    debts: rules === 'v2' ? debts : [],
    savingsAccount,
    reinvestAccount,
    expectedRealReturn: (1 + plan.assumptions.expectedReturn / 100) / (1 + inflation) - 1,
    assetReturnsPct: {
      equity: plan.assumptions.assetReturns.equityPct,
      bond: plan.assumptions.assetReturns.bondPct,
      cash: plan.assumptions.assetReturns.cashPct,
    },
    strategy: rules === 'v2' && strategy.kind === 'expenses' ? 'expenses' : 'initialPct',
    spendingStrategy: rules === 'v2' ? strategy : { kind: 'initialPct', ratePct: strategy.kind === 'initialPct' ? strategy.ratePct : 4 },
    withdrawalOrder: rules === 'v2' ? plan.drawdown.order : 'proRata',
    rrifConversionAge: plan.drawdown.rrifConversionAge,
    rrifUseYoungerSpouseAge: plan.drawdown.rrifUseYoungerSpouseAge,
    meltdown: rules === 'v2' ? plan.drawdown.meltdown : { enabled: false, targetTaxableIncome: 0 },
    probate: plan.estate.probate,
    simpleSpendingTarget: finalSalaries * (plan.expenses.replacementRate / 100),
    initialWithdrawalRatePct: strategy.kind === 'initialPct' ? strategy.ratePct
      : strategy.kind === 'pctPortfolio' ? strategy.ratePct
        : strategy.kind === 'guytonKlinger' ? strategy.initialRatePct
          : 4,
    pensionSplitting: plan.drawdown.pensionSplitting,
    refundTargets,
    expectedReturnPct: plan.assumptions.expectedReturn,
    inflationPct: plan.assumptions.inflationRate,
  }
}

function incomeFlow(
  stream: IncomeStream,
  offsetOf: (p: TimePoint | undefined, fallback: number) => number,
  years: number,
): CompiledFlow {
  const start = Math.max(0, offsetOf(stream.from, 0))
  const end = stream.frequency === 'oneTime' ? start + 1 : offsetOf(stream.to, years)
  const flow: CompiledFlow = {
    startOffset: start,
    endOffset: end,
    amount: stream.amount,
    basis: stream.growth.kind === 'cpi' ? 'real' : 'nominal',
    ratePct: stream.growth.kind === 'none' ? 0 : stream.growth.pct,
    everyN: 1,
  }
  if (stream.kind === 'dbPension' && stream.db && stream.db.indexationPctOfCpi < 100) {
    flow.indexFracInPayment = stream.db.indexationPctOfCpi / 100
  }
  return flow
}

function expenseFlow(
  item: ExpenseItem,
  offsetOf: (p: TimePoint | undefined, fallback: number) => number,
  years: number,
): CompiledFlow {
  const start = offsetOf(item.from, 0)
  const multiplier = item.frequency === 'monthly' ? 12 : 1
  return {
    startOffset: start,
    endOffset: item.frequency === 'oneTime' ? start + 1 : offsetOf(item.to, years),
    amount: item.amount * multiplier,
    // The simple-mode gift pot always prices one-time items in real terms.
    basis: item.indexed || item.frequency === 'oneTime' ? 'real' : 'nominal',
    ratePct: item.realGrowthPct,
    everyN: item.frequency === 'everyNYears' ? (item.everyNYears ?? 1) : 1,
  }
}
