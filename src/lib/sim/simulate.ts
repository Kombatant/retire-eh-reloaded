import { cppAdjustmentFactor, getCppIncomeAtAge, getOasIncomeAtAge } from '@/lib/calculations'
import { computeRetirementTaxSummary, OAS_MAX_ANNUAL_2026 } from '@/lib/tax/quebecLegacy'
import { computeHouseholdTax, type HouseholdTaxResult } from '@/lib/tax/household'
import { CAPITAL_GAINS_INCLUSION, computeIncomeTax, emptyIncome, marginalTaxRate, type IncomeTaxInput } from '@/lib/tax/personal'
import { TAX_2026 } from '@/lib/tax/data/2026'
import { probateFee } from '@/lib/tax/probate'
import { MAX_CPP_ANNUAL_2026 } from '@/lib/plan/schema'
import { oasAnnualAmount } from '@/lib/benefits/oas'
import { gisAnnual } from '@/lib/benefits/gis'
import { cppSurvivorBenefit } from '@/lib/benefits/cpp'
import { calculateFutureValue, sum } from './math'
import { amortizeYear } from './steps/debts'
import { solveIncreasing } from './steps/solver'
import { LIF_EARLIEST_AGE, lifMaximumFactor, rrifMinimumFactor } from './steps/rrif'
import { strategyWithdrawal, type StrategyState } from './steps/spendingStrategy'
import type { CompiledFlow, CompiledPlan, DrawdownSnapshot, EstateResult, MarketPath, PersonYear, RsuAward, SimResult, YearRow } from './types'

const DIVIDEND_GROSS_UP = 1 + TAX_2026.federal.eligibleDividendGrossUp
const LIMITS = TAX_2026.limits

// Cumulative price index: cpi[t] converts plan-start dollars to year-t dollars.
export function cumulativeCpi(inflation: Float64Array, years: number): Float64Array {
  const cpi = new Float64Array(years)
  cpi[0] = 1
  for (let t = 1; t < years; t++) cpi[t] = cpi[t - 1] * (1 + (inflation[t - 1] ?? 0))
  return cpi
}

// Nominal value of a flow in every simulated year for one market path.
export function flowSeries(flow: CompiledFlow, cpi: Float64Array, inflation: Float64Array): Float64Array {
  const years = cpi.length
  const out = new Float64Array(years)
  const start = Math.max(0, flow.startOffset)
  const end = Math.min(years, flow.endOffset)
  const growth = 1 + flow.ratePct / 100
  for (let t = start; t < end; t++) {
    if ((t - flow.startOffset) % flow.everyN !== 0) continue
    const base = flow.amount * Math.pow(growth, t)
    out[t] = flow.basis === 'real' ? base * cpi[t] : base
  }
  // Partially indexed DB pensions: full CPI until payments begin, then only
  // the indexed fraction of each year's inflation.
  if (flow.indexFracInPayment !== undefined && start < end) {
    let value = out[start]
    for (let t = start + 1; t < end; t++) {
      value *= 1 + flow.indexFracInPayment * (inflation[t - 1] ?? 0)
      out[t] = value
    }
  }
  return out
}

function addInto(target: Float64Array, source: Float64Array, scale = 1, fromOffset = 0) {
  for (let i = Math.max(0, fromOffset); i < target.length; i++) target[i] += source[i] * scale
}

interface IncomeBuckets {
  employment: Float64Array
  pension: Float64Array
  otherOrdinary: Float64Array
  eligibleDividends: Float64Array
  capitalGains: Float64Array
  nonTaxable: Float64Array
  // One-time receipts that are invested rather than spent.
  deposited: Float64Array
}

function bucketIncomes(c: CompiledPlan, cpi: Float64Array, inflation: Float64Array, depositSeries: Float64Array[]): IncomeBuckets[] {
  const years = c.years
  const buckets: IncomeBuckets[] = c.people.map(() => ({
    employment: new Float64Array(years),
    pension: new Float64Array(years),
    otherOrdinary: new Float64Array(years),
    eligibleDividends: new Float64Array(years),
    capitalGains: new Float64Array(years),
    nonTaxable: new Float64Array(years),
    deposited: new Float64Array(years),
  }))
  for (const income of c.incomes) {
    // Paid in shares, not cash: handled with the other stock compensation.
    if (income.kind === 'rsu') continue
    const series = flowSeries(income.flow, cpi, inflation)
    const b = buckets[income.personIndex]
    if (income.taxTreatment === 'nonTaxable') addInto(b.nonTaxable, series)
    else if (income.taxTreatment === 'capitalGain') addInto(b.capitalGains, series)
    else if (income.taxTreatment === 'eligibleDividend') addInto(b.eligibleDividends, series)
    else if (income.kind === 'employment' || income.kind === 'bonus' || income.kind === 'selfEmployment') addInto(b.employment, series)
    else if (income.kind === 'dbPension' || income.kind === 'annuity') addInto(b.pension, series)
    else addInto(b.otherOrdinary, series)
    if (income.depositAccount >= 0) {
      addInto(b.deposited, series)
      addInto(depositSeries[income.depositAccount], series)
    }
    // A DB survivor pension continues to the spouse after the owner dies.
    if (income.survivorFraction > 0 && c.people.length === 2) {
      const spouse = buckets[1 - income.personIndex]
      addInto(spouse.pension, series, income.survivorFraction, c.people[income.personIndex].endOffset + 1)
    }
  }
  return buckets
}

type TaxMember = Omit<IncomeTaxInput, 'pensionSplit'>

interface PlannedWithdrawal {
  taken: number[]
  registered: number[] // per person
  gains: number[] // per person
}

// Year-by-year household simulation in nominal dollars.
//
// Conventions kept from the original engine:
// - Before the household starts drawing down (when its last member retires),
//   contributions are monthly and growth compounds monthly at nominal rate / 12.
// - In drawdown, the year's withdrawal comes out at the start of the year and
//   the remainder grows at the annual nominal rate.
// - Tax is computed in plan-start dollars with today's rules, which is
//   equivalent to fully indexed brackets. Jurisdictions that freeze their
//   thresholds get bracket creep through the tax engine's deflator.
//
// Spending:
// - Simple mode (the original model): the withdrawal follows the drawdown
//   strategy; gifts are a pot reserved at the start of drawdown.
// - Detailed mode: spending is the sum of expense items, property costs and
//   debt payments in every year. Working-year shortfalls are drawn from the
//   portfolio (grossed up for tax); surpluses are saved if the plan says so.
//   The "expenses" strategy withdraws exactly what after-tax spending needs;
//   other strategies never cut below essential spending.
//
// Registered accounts: RRSPs convert to RRIFs at the conversion age and then
// pay at least the RRIF minimum; LIRAs unlock as LIFs (minimum and maximum).
// Forced or meltdown withdrawals not needed for spending are reinvested.
//
// Deaths (v2): a person's income stops after their life expectancy. Their
// accounts roll over to the surviving spouse tax-free; DB survivor pensions
// and the CPP survivor's pension continue. At the end of the plan the estate
// is taxed as a deemed disposition, less probate.
//
// v1 rules reproduce the original engine for parity tests.
export function simulate(c: CompiledPlan, path: MarketPath): SimResult {
  const years = c.years
  const D = c.drawdownStartOffset
  const v2 = c.rules === 'v2'
  const detailed = c.expenseMode === 'detailed'
  const cpi = cumulativeCpi(path.inflation, years)
  const accountCount = c.accounts.length
  const peopleCount = c.people.length
  const zeros = (): number[] => new Array(peopleCount).fill(0)
  const isAlive = (i: number, t: number) => !v2 || t <= c.people[i].endOffset

  const contributionSeries = c.accounts.map(a => {
    const total = new Float64Array(years)
    for (const flow of a.contributions) addInto(total, flowSeries(flow, cpi, path.inflation))
    return total
  })
  const depositSeries = c.accounts.map(() => new Float64Array(years))
  const incomeByPerson = bucketIncomes(c, cpi, path.inflation, depositSeries)
  const rsuBonuses = c.incomes.flatMap(i => (i.rsu
    ? [{ ...i.rsu, employee: i.personIndex, series: flowSeries(i.flow, cpi, path.inflation) }]
    : []))

  // Spending series (detailed mode) and the simple-mode reserved gift pot.
  const essentialSpending = new Float64Array(years)
  const discretionarySpending = new Float64Array(years)
  const oneTimePot = new Float64Array(years)
  for (const expense of c.expenses) {
    if (!detailed && expense.oneTime) {
      // One-time expenses before drawdown are reserved and paid at the start
      // of drawdown, in that year's dollars.
      const start = expense.flow.startOffset
      if (start < 0 || start >= years) continue
      const at = Math.max(start, D)
      if (at >= years) continue
      oneTimePot[at] += expense.flow.amount * Math.pow(1 + expense.flow.ratePct / 100, start) * cpi[at]
      continue
    }
    if (!detailed) continue
    addInto(expense.essential ? essentialSpending : discretionarySpending, flowSeries(expense.flow, cpi, path.inflation))
  }
  const phaseMultiplier = new Float64Array(years).fill(1)
  for (const phase of c.phases) {
    for (let t = Math.max(0, phase.startOffset); t < Math.min(years, phase.endOffset); t++) phaseMultiplier[t] *= phase.multiplier
  }

  const balances = c.accounts.map(a => Math.max(0, a.initialBalance))
  const acb = c.accounts.map(a => Math.max(0, a.initialAcb))
  const lifetimeRoom = c.accounts.map(a => a.lifetimeRoom)
  // Ownership changes when a spouse dies (rollover).
  const owner = c.accounts.map(a => a.ownerIndex)
  // Each account's return differs from the path by its expected-return spread.
  const spread = c.accounts.map(a => (a.expectedReturnPct - c.expectedReturnPct) / 100)

  // Stock portfolios: value and price per holding. Generic account operations
  // (withdrawals, contributions) change the account balance; holdings are
  // then rescaled in proportion, which is how a pro-rata sale works.
  const stockAccounts = c.accounts.flatMap((a, i) => (a.stock ? [i] : []))
  const holdingValue = new Float64Array(c.holdingCount)
  const holdingPrice = new Float64Array(c.holdingCount)
  const esppSeries: Float64Array[] = []
  for (const a of stockAccounts) {
    for (const h of c.accounts[a].stock!.holdings) {
      holdingValue[h.index] = h.shares * h.price
      holdingPrice[h.index] = h.price
      esppSeries[h.index] = h.espp ? flowSeries(h.espp.flow, cpi, path.inflation) : new Float64Array(years)
    }
  }
  const holdingsTotal = (a: number) => c.accounts[a].stock!.holdings.reduce((s, h) => s + holdingValue[h.index], 0)
  const syncHoldings = (a: number) => {
    const holdings = c.accounts[a].stock?.holdings
    if (!holdings || holdings.length === 0) return
    const total = holdingsTotal(a)
    if (total > 0) {
      const scale = balances[a] / total
      for (const h of holdings) holdingValue[h.index] *= scale
    } else {
      for (const h of holdings) holdingValue[h.index] = balances[a] / holdings.length
    }
  }
  const growStock = (a: number, t: number) => {
    for (const h of c.accounts[a].stock!.holdings) {
      const r = path.stocks?.[h.index]?.[t] ?? h.growth + h.dividendYield
      holdingValue[h.index] *= 1 + r
      holdingPrice[h.index] *= Math.max(0, 1 + r - h.dividendYield)
    }
    balances[a] = holdingsTotal(a)
  }

  const propertyValue = c.properties.map(p => p.value)
  const propertyAcb = c.properties.map(p => p.acb)
  const propertyOwned = c.properties.map(() => true)
  const propertyOwner = c.properties.map(p => p.ownerIndex)
  const debtBalance = c.debts.map(d => d.balance)

  // Contribution room in nominal dollars; NaN when not tracked.
  const rrspRoom = c.people.map(p => (p.rrspRoom === undefined ? NaN : p.rrspRoom))
  const tfsaRoom = c.people.map(p => (p.tfsaRoom === undefined ? NaN : p.tfsaRoom))
  let priorTfsaWithdrawals = zeros()

  const rows: YearRow[] = []
  let depletionOffset: number | null = null
  let snapshot: DrawdownSnapshot | null = null
  const strategy: StrategyState = { initialWithdrawal: 0, initialRate: c.initialWithdrawalRatePct / 100, lastWithdrawal: 0, lastReturn: 0, lastInflation: 0 }

  for (let t = 0; t < years; t++) {
    const r = path.nominalReturn[t] ?? 0
    const k = cpi[t]
    // Accounts with an asset mix follow the asset-class paths when the
    // scenario has them; others follow the default portfolio path.
    const accountReturn = c.accounts.map((a, i) => {
      const mix = a.allocation
      if (mix && path.assets) {
        return mix.equity * path.assets.equity[t] + mix.bond * path.assets.bond[t] + mix.cash * path.assets.cash[t]
      }
      return r + spread[i]
    })
    const alive = c.people.map((_, i) => isAlive(i, t))
    const aliveIdx = alive.flatMap((a, i) => (a ? [i] : []))

    // Spousal rollover: the first year after a death, the survivor takes
    // over the deceased's accounts and property.
    if (v2 && aliveIdx.length > 0) {
      for (let a = 0; a < accountCount; a++) if (owner[a] >= 0 && !alive[owner[a]]) owner[a] = aliveIdx[0]
      for (let p = 0; p < propertyOwner.length; p++) if (propertyOwner[p] >= 0 && !alive[propertyOwner[p]]) propertyOwner[p] = aliveIdx[0]
    }
    const balancesStart = balances.slice()

    const peopleYear: PersonYear[] = c.people.map((p, i) => {
      const age = c.startYear + t - p.birthYear
      const income = incomeByPerson[i]
      const live = alive[i] ? 1 : 0
      const oasReal = v2
        ? oasAnnualAmount({ age, startAge: p.oasStartAge, yearsInCanadaAfter18: p.yearsInCanadaAfter18 })
        : getOasIncomeAtAge(OAS_MAX_ANNUAL_2026, p.oasStartAge, age)
      let cppReal = getCppIncomeAtAge(p.cppAt65, p.cppStartAge, age)
      // CPP survivor's pension from a deceased spouse.
      if (v2 && live && peopleCount === 2 && !alive[1 - i]) {
        const deceased = c.people[1 - i]
        cppReal += cppSurvivorBenefit({
          deceasedPension: deceased.cppAt65 * cppAdjustmentFactor(deceased.cppStartAge),
          survivorOwnPension: cppReal,
          survivorAge: age,
          maxRetirementPension: MAX_CPP_ANNUAL_2026,
        })
      }
      return {
        age,
        alive: alive[i],
        employment: income.employment[t] * live,
        pension: income.pension[t] * live,
        cpp: cppReal * k * live,
        oas: oasReal * k * live,
        gis: 0,
        otherIncome: v2
          ? (income.otherOrdinary[t] + income.eligibleDividends[t] + income.capitalGains[t] + income.nonTaxable[t] - income.deposited[t]) * live
          : 0,
        registeredWithdrawals: 0,
        minimumWithdrawals: 0,
        stockCompensation: 0,
        pensionSplit: 0,
        taxableIncome: 0,
        federal: 0,
        provincial: 0,
        tax: 0,
        oasClawback: 0,
        payroll: 0,
        rrspRefund: 0,
        investmentIncome: 0,
        realizedGains: 0,
        rrspRoom: NaN,
        tfsaRoom: NaN,
      }
    })

    const row: YearRow = {
      offset: t,
      year: c.startYear + t,
      cpi: k,
      cpiEnd: k * (1 + (path.inflation[t] ?? 0)),
      phase: t < D ? 'accumulation' : 'drawdown',
      people: peopleYear,
      balancesStart,
      balancesEnd: balancesStart,
      contributions: 0,
      oneTimeExpenses: 0,
      withdrawal: 0,
      withdrawalsByAccount: new Array(accountCount).fill(0),
      taxableWithdrawal: 0,
      taxFreeWithdrawal: 0,
      shortfall: 0,
      tax: 0,
      oasClawback: 0,
      gis: 0,
      otherIncome: peopleYear.reduce((s, p) => s + p.otherIncome, 0),
      rrspRefunds: 0,
      investmentIncome: 0,
      realizedGains: 0,
      deposits: 0,
      spending: 0,
      debtPayments: 0,
      surplus: 0,
      propertyValue: 0,
      debtBalance: 0,
      netWorth: 0,
      meltdownWithdrawals: 0,
      reinvested: 0,
      saved: 0,
      stockValue: 0,
      unvestedValue: 0,
      stockSales: 0,
      stockCompensation: 0,
      stockTaxWithheld: 0,
      rsuAwards: [],
      guaranteedIncome: 0,
      grossIncome: 0,
      afterTaxIncome: 0,
    }

    // Split an amount owned by a person (or jointly) among living people.
    const creditOwner = (target: number[], who: number, amount: number) => {
      if (who >= 0 && alive[who]) target[who] += amount
      else if (aliveIdx.length > 0) for (const j of aliveIdx) target[j] += amount / aliveIdx.length
    }
    const credit = (target: number[], a: number, amount: number) => creditOwner(target, owner[a], amount)
    const realized = zeros()

    const deposit = (a: number, amount: number) => {
      if (a < 0 || amount <= 0) return
      balances[a] += amount
      acb[a] += amount
      row.deposits += amount
    }

    // Registered-account rules for this year: RRIF minimums, LIF maximums,
    // locked-in LIRAs. Ages are at January 1 (age reached this year − 1).
    const minimum = new Array(accountCount).fill(0)
    const maximum = new Array(accountCount).fill(Infinity)
    if (v2) {
      for (let a = 0; a < accountCount; a++) {
        const acct = c.accounts[a]
        const o = owner[a]
        if (o < 0 || !['RRSP', 'RRIF', 'LIRA', 'LIF'].includes(acct.type)) continue
        const ageJan1 = peopleYear[o].age - 1
        const spouseAges = aliveIdx.map(j => peopleYear[j].age - 1)
        const minAge = c.rrifUseYoungerSpouseAge ? Math.min(ageJan1, ...spouseAges) : ageJan1
        const retired = t >= c.people[o].retirementOffset
        if (acct.type === 'RRSP' || acct.type === 'RRIF') {
          const isRrif = acct.type === 'RRIF' || ageJan1 >= c.rrifConversionAge
          if (isRrif) minimum[a] = balances[a] * rrifMinimumFactor(minAge)
        } else {
          // LIRAs unlock as a LIF once the owner is 55 and retired (or 71).
          const unlocked = peopleYear[o].age >= LIF_EARLIEST_AGE && (acct.type === 'LIF' || retired || ageJan1 >= c.rrifConversionAge)
          if (!unlocked) {
            maximum[a] = 0
          } else {
            minimum[a] = ageJan1 >= c.rrifConversionAge || acct.type === 'LIF' ? balances[a] * rrifMinimumFactor(minAge) : 0
            maximum[a] = Math.max(minimum[a], balances[a] * lifMaximumFactor(ageJan1))
          }
        }
        peopleYear[o].minimumWithdrawals += minimum[a]
      }
      // A fixed-amount stock sell plan works like a required withdrawal.
      for (const a of stockAccounts) {
        const sale = c.accounts[a].stock!.sale
        if (sale.kind === 'fixedAmount' && t >= sale.startOffset && t < sale.endOffset) {
          minimum[a] = Math.min(balances[a], sale.amount * k)
        }
      }
    }
    // "Cover the gap" sell plans draw stock before any other account.
    const drawFirst = stockAccounts.filter(a => {
      const sale = c.accounts[a].stock!.sale
      return sale.kind === 'coverGap' && t >= sale.startOffset && t < sale.endOffset
    })
    const takenThisYear = new Array(accountCount).fill(0)

    // Plan a withdrawal without changing balances, so the solver can try
    // amounts; apply it once the amount is settled. Required minimums always
    // come out; the rest follows the withdrawal order (or pro rata).
    const planWithdrawal = (amount: number, only?: (a: number) => boolean): PlannedWithdrawal => {
      const cap = balances.map((b, a) => (only && !only(a) ? 0 : Math.max(0, Math.min(b, maximum[a] - takenThisYear[a]))))
      const taken = cap.map((cp, a) => (only ? 0 : Math.min(cp, Math.max(0, minimum[a] - takenThisYear[a]))))
      let remaining = Math.max(0, amount) - sum(taken)
      const fill = (members: number[]) => {
        const headroom = members.reduce((s, a) => s + (cap[a] - taken[a]), 0)
        if (remaining <= 0 || headroom <= 0) return
        const share = Math.min(1, remaining / headroom)
        for (const a of members) {
          const extra = (cap[a] - taken[a]) * share
          taken[a] += extra
          remaining -= extra
        }
      }
      const all = c.accounts.map((_, a) => a)
      if (drawFirst.length > 0) fill(drawFirst)
      if (c.withdrawalOrder === 'custom') {
        const ranks = [...new Set(c.accounts.map(a => a.orderRank))].sort((x, y) => x - y)
        for (const rank of ranks) fill(all.filter(a => c.accounts[a].orderRank === rank))
      } else {
        fill(all)
      }
      const plan: PlannedWithdrawal = { taken, registered: zeros(), gains: zeros() }
      for (let a = 0; a < accountCount; a++) {
        if (taken[a] <= 0) continue
        if (c.accounts[a].taxable) credit(plan.registered, a, taken[a])
        if (c.accounts[a].nonRegistered && balances[a] > 0) {
          credit(plan.gains, a, taken[a] * (1 - Math.min(1, acb[a] / balances[a])))
        }
      }
      return plan
    }
    const applyWithdrawal = (plan: PlannedWithdrawal) => {
      for (let a = 0; a < accountCount; a++) {
        const taken = plan.taken[a]
        if (taken <= 0) continue
        if (c.accounts[a].nonRegistered && balances[a] > 0) acb[a] -= taken * Math.min(1, acb[a] / balances[a])
        balances[a] -= taken
        takenThisYear[a] += taken
        if (c.accounts[a].stock) syncHoldings(a)
      }
      for (let i = 0; i < peopleCount; i++) realized[i] += plan.gains[i]
    }
    const tfsaWithdrawals = zeros()
    const recordWithdrawal = (plan: PlannedWithdrawal) => {
      const total = sum(plan.taken)
      row.withdrawal += total
      plan.taken.forEach((v, i) => { row.withdrawalsByAccount[i] += v })
      row.taxableWithdrawal += c.accounts.reduce((s, a, i) => s + (a.taxable ? plan.taken[i] : 0), 0)
      row.taxFreeWithdrawal = row.withdrawal - row.taxableWithdrawal
      plan.registered.forEach((v, i) => { peopleYear[i].registeredWithdrawals += v })
      for (const a of stockAccounts) row.stockSales += plan.taken[a]
      c.accounts.forEach((a, i) => {
        if (a.type === 'TFSA' && plan.taken[i] > 0 && owner[i] >= 0) tfsaWithdrawals[owner[i]] += plan.taken[i]
      })
    }
    const mergePlans = (x: PlannedWithdrawal, y: PlannedWithdrawal): PlannedWithdrawal => ({
      taken: x.taken.map((v, i) => v + y.taken[i]),
      registered: x.registered.map((v, i) => v + y.registered[i]),
      gains: x.gains.map((v, i) => v + y.gains[i]),
    })

    // Windfalls are invested at the start of the year.
    for (let a = 0; a < accountCount; a++) {
      if (depositSeries[a][t] > 0) deposit(a, depositSeries[a][t])
    }

    // RSUs vest and ESPP purchases settle at this year's price. The value is
    // employment income paid in shares, and becomes the cost base. Unvested
    // grants and ESPP stop if the employee has died.
    let esppCash = 0
    const sellToCover: { a: number; holding: number; employee: number; value: number; award?: RsuAward }[] = []
    for (const a of stockAccounts) {
      const employee = c.accounts[a].ownerIndex
      const employed = v2 && employee >= 0 && alive[employee]
      for (const h of c.accounts[a].stock!.holdings) {
        if (!employed) continue
        const price = holdingPrice[h.index]
        let added = 0
        let benefit = 0
        for (const g of h.grants) {
          if (g.offset === t) {
            added += g.shares * price
            benefit += g.shares * price
            if (h.sellToCover && v2) sellToCover.push({ a, holding: h.index, employee, value: g.shares * price })
          } else if (g.offset > t) {
            row.unvestedValue += g.shares * price
          }
        }
        const contribution = h.espp ? esppSeries[h.index][t] : 0
        if (contribution > 0 && h.espp) {
          const fairValue = contribution * (1 + h.espp.match) / (1 - h.espp.discount)
          added += fairValue
          benefit += fairValue - contribution
          esppCash += contribution
        }
        if (added <= 0) continue
        holdingValue[h.index] += added
        balances[a] += added
        acb[a] += added
        peopleYear[employee].stockCompensation += benefit
        row.stockCompensation += benefit
      }
    }
    row.contributions += esppCash

    // RSU bonuses are a dollar value, so a higher projected price means fewer
    // shares for the same award. Taxed like any other vest.
    for (const bonus of rsuBonuses) {
      const value = bonus.series[t]
      if (value <= 0 || !alive[bonus.employee]) continue
      const { account: a, holding, employee } = bonus
      if (holding >= 0) holdingValue[holding] += value
      balances[a] += value
      acb[a] += value
      peopleYear[employee].stockCompensation += value
      row.stockCompensation += value
      const price = holding >= 0 ? holdingPrice[holding] : 0
      const award: RsuAward | undefined = price > 0
        ? { incomeId: bonus.incomeId, value, price, shares: value / price, sharesKept: value / price }
        : undefined
      if (award) row.rsuAwards.push(award)
      if (bonus.sellToCover) sellToCover.push({ a, holding, employee, value, award })
    }

    // Property sales happen at the start of the year: repay the mortgage,
    // buy any replacement home, invest the rest.
    c.properties.forEach((prop, p) => {
      if (prop.saleOffset !== t || !propertyOwned[p]) return
      const gross = propertyValue[p]
      const costs = gross * prop.sellingCost
      let repaid = 0
      c.debts.forEach((d, j) => {
        if (d.propertyIndex === p) {
          repaid += debtBalance[j]
          debtBalance[j] = 0
        }
      })
      if (!prop.principalResidence) creditOwner(realized, propertyOwner[p], Math.max(0, gross - costs - propertyAcb[p]))
      const replacement = prop.replacementValue * k
      const cash = gross - costs - repaid - replacement
      if (cash > 0) deposit(prop.proceedsAccount, cash)
      else if (cash < 0) applyWithdrawal(planWithdrawal(-cash))
      if (replacement > 0) {
        propertyValue[p] = replacement
        propertyAcb[p] = replacement
      } else {
        propertyOwned[p] = false
        propertyValue[p] = 0
      }
    })

    // Taxable distributions from non-registered and cash accounts, reinvested
    // (they raise the cost base). They are part of the account's return.
    const invOrdinary = zeros()
    const invEligible = zeros()
    for (let a = 0; a < accountCount; a++) {
      const acct = c.accounts[a]
      if (!acct.nonRegistered || balances[a] <= 0) continue
      const y = acct.yields
      const interest = acct.interestOnly ? Math.max(0, accountReturn[a]) * balances[a] : y.interest * balances[a]
      const foreign = y.foreignDividends * balances[a]
      const eligible = y.eligibleDividends * balances[a]
      credit(invOrdinary, a, interest + foreign)
      credit(invEligible, a, eligible)
      if (!acct.interestOnly) acb[a] += interest + foreign + eligible
    }
    // Stock dividends are reinvested and taxed each year.
    if (v2) {
      for (const a of stockAccounts) {
        for (const h of c.accounts[a].stock!.holdings) {
          const dividend = holdingValue[h.index] * h.dividendYield
          if (dividend <= 0) continue
          credit(h.dividendEligible ? invEligible : invOrdinary, a, dividend)
          acb[a] += dividend
        }
      }
    }

    // Debt payments for the year.
    c.debts.forEach((d, j) => {
      if (debtBalance[j] <= 0) return
      const step = amortizeYear(debtBalance[j], d.annualRate, d.monthlyPayment)
      debtBalance[j] = step.balance
      row.debtPayments += step.paid
    })

    // Spending need for the year.
    let essentialNeed = 0
    if (detailed) {
      const propertyCosts = c.properties.reduce((s, prop, p) => s + (propertyOwned[p] ? prop.annualCosts * k : 0), 0)
      essentialNeed = essentialSpending[t] + propertyCosts + row.debtPayments
      row.spending = essentialNeed + discretionarySpending[t] * phaseMultiplier[t]
    } else if (t >= D) {
      row.spending = c.simpleSpendingTarget * k
    }

    // Real-dollar tax inputs for each living person (v2 only).
    const taxInputs = (registered: number[], rrspDeduction: number[], extraGains?: number[]): TaxMember[] =>
      aliveIdx.map(i => {
        const income = incomeByPerson[i]
        const p = c.people[i]
        return {
          province: p.province,
          age: peopleYear[i].age,
          employment: (peopleYear[i].employment + peopleYear[i].stockCompensation) / k,
          pension: peopleYear[i].pension / k,
          registeredWithdrawals: registered[i] / k,
          cpp: peopleYear[i].cpp / k,
          oas: peopleYear[i].oas / k,
          otherOrdinary: (income.otherOrdinary[t] + invOrdinary[i]) / k,
          eligibleDividends: (income.eligibleDividends[t] + invEligible[i]) / k,
          capitalGains: (income.capitalGains[t] + realized[i] + (extraGains?.[i] ?? 0)) / k,
          rrspDeduction: rrspDeduction[i] / k,
        }
      })
    const taxOpts = { deflator: 1 / k, splitting: c.pensionSplitting }
    const householdTax = (inputs: TaxMember[]) => computeHouseholdTax(inputs, taxOpts)
    const gisFor = (inputs: TaxMember[]) => gisAnnual(inputs.map(m => ({
      receivesOas: m.oas > 0,
      employmentIncome: m.employment,
      otherIncome: m.pension + m.registeredWithdrawals + m.cpp + m.otherOrdinary +
        m.eligibleDividends * DIVIDEND_GROSS_UP + m.capitalGains * CAPITAL_GAINS_INCLUSION,
    })))

    const recordTax = (household: HouseholdTaxResult) => {
      household.perPerson.forEach((res, m) => {
        const p = peopleYear[aliveIdx[m]]
        p.pensionSplit = household.splits[m] * k
        p.taxableIncome = res.taxableIncome * k
        p.federal = res.federal * k
        p.provincial = res.provincial * k
        p.oasClawback = res.oasClawback * k
        p.tax = res.total * k
        p.payroll = res.payroll.total * k
      })
      row.tax = household.total * k
      row.oasClawback = household.perPerson.reduce((s, res) => s + res.oasClawback, 0) * k
    }
    const recordGis = (inputs: TaxMember[]) => {
      const gis = gisFor(inputs)
      gis.forEach((g, m) => { peopleYear[aliveIdx[m]].gis = g * k })
      row.gis = sum(gis) * k
    }
    const payrollTotal = () => peopleYear.reduce((s, p) => s + p.payroll, 0)
    const guaranteedBeforeGis = () => peopleYear.reduce((s, p) => s + p.pension + p.cpp + p.oas, 0)
    const noDeduction = zeros()

    // After-tax cash for a planned withdrawal (v2), including GIS.
    const afterTaxCash = (planned: PlannedWithdrawal, deduction = noDeduction) => {
      const inputs = taxInputs(planned.registered, deduction, planned.gains)
      const tax = householdTax(inputs).total * k
      const gis = sum(gisFor(inputs)) * k
      return guaranteedBeforeGis() + gis + row.otherIncome + sum(planned.taken) +
        peopleYear.reduce((s, p) => s + p.employment, 0) - tax - payrollTotal() + withheld
    }

    // Reinvest cash that was withdrawn but not needed (forced minimums,
    // meltdown) into the owner's TFSA if they have one, else non-registered.
    const reinvest = (amount: number, preferTfsaOf = -1) => {
      if (amount <= 0) return
      const tfsa = preferTfsaOf >= 0 ? c.accounts.findIndex((a, i) => a.type === 'TFSA' && owner[i] === preferTfsaOf) : -1
      const target = tfsa >= 0 ? tfsa : c.reinvestAccount
      if (target < 0) return
      deposit(target, amount)
      row.reinvested += amount
    }

    // Sell to cover: part of the shares vesting this year is sold at once to
    // pay the income tax and payroll deductions they add. Those are the shares
    // just received (cost = price), so the sale has no capital gain. The tax
    // still counts in the year's tax; it is paid by the shares, not from cash.
    let withheld = 0
    if (sellToCover.length > 0) {
      const payroll = (h: HouseholdTaxResult) => h.perPerson.reduce((s, r) => s + r.payroll.total, 0)
      const full = householdTax(taxInputs(zeros(), zeros()))
      for (const employee of new Set(sellToCover.map(v => v.employee))) {
        const m = aliveIdx.indexOf(employee)
        if (m < 0) continue
        const vests = sellToCover.filter(v => v.employee === employee)
        const value = sum(vests.map(v => v.value))
        const inputs = taxInputs(zeros(), zeros())
        inputs[m] = { ...inputs[m], employment: inputs[m].employment - value / k }
        const without = householdTax(inputs)
        const due = Math.min(value, Math.max(0, (full.total + payroll(full) - without.total - payroll(without)) * k))
        for (const v of vests) {
          const sold = due * (v.value / value)
          if (v.holding >= 0) holdingValue[v.holding] -= sold
          balances[v.a] -= sold
          acb[v.a] -= sold
          if (v.award) v.award.sharesKept -= sold / v.award.price
        }
        withheld += due
      }
      row.stockTaxWithheld = withheld
    }

    const contributedTo = { rrsp: zeros(), tfsa: zeros() }
    let toSave = 0

    if (t < D) {
      const contributions = c.accounts.map((acct, a) => {
        let amount = contributionSeries[a][t]
        if (owner[a] >= 0 && !alive[owner[a]]) amount = 0
        if (acct.type === 'FHSA') {
          amount = Math.min(amount, LIMITS.fhsaAnnual, lifetimeRoom[a])
          lifetimeRoom[a] -= amount
        }
        return amount
      })

      if (v2) {
        const deductible = zeros()
        c.accounts.forEach((a, i) => {
          if (a.deductible && owner[i] >= 0) deductible[owner[i]] += contributions[i]
        })
        const withDeduction = householdTax(taxInputs(zeros(), deductible))
        recordTax(withDeduction)
        // The refund is the tax this person's deductions save this year.
        c.refundTargets.forEach((target, i) => {
          if (target < 0 || deductible[i] <= 0) return
          const withoutOwn = deductible.map((v, j) => (j === i ? 0 : v))
          const without = householdTax(taxInputs(zeros(), withoutOwn))
          const refund = Math.max(0, without.total - withDeduction.total) * k
          peopleYear[i].rrspRefund = refund
          contributions[target] += refund
          row.rrspRefunds += refund
        })

        // Required RRIF/LIF minimums of anyone already retired come out even
        // while others still work; the after-tax amount is reinvested.
        const forced = planWithdrawal(0)
        if (sum(forced.taken) > 0) {
          const before = withDeduction.total * k
          const inputs = taxInputs(forced.registered, deductible, forced.gains)
          const after = householdTax(inputs)
          recordTax(after)
          applyWithdrawal(forced)
          recordWithdrawal(forced)
          if (!detailed) reinvest(sum(forced.taken) - (after.total * k - before))
        }

        if (detailed) {
          // Working-year cash flow: earnings, benefits and withdrawals, less
          // tax, payroll, contributions and spending.
          const inflow = peopleYear.reduce((s, p) => s + p.employment + p.pension + p.cpp + p.oas, 0) + row.otherIncome + row.withdrawal + withheld
          const cashWithoutExtra = inflow - row.tax - payrollTotal() - sum(contributions) - esppCash - row.spending
          row.surplus = cashWithoutExtra
          if (cashWithoutExtra >= 0) {
            if (c.savingsAccount >= 0) toSave = cashWithoutExtra
            else if (row.withdrawal > 0) reinvest(Math.min(cashWithoutExtra, row.withdrawal))
          } else {
            // Draw the shortfall from savings, grossed up for the tax it causes.
            const baseTax = row.tax
            const cashAfter = (w: number) => {
              const planned = planWithdrawal(w)
              const tax = householdTax(taxInputs(planned.registered.map((v, i) => v + peopleYear[i].registeredWithdrawals), deductible, planned.gains)).total * k
              return cashWithoutExtra + sum(planned.taken) - (tax - baseTax)
            }
            const w = solveIncreasing(cashAfter, 0, sum(balances))
            const planned = planWithdrawal(w)
            recordTax(householdTax(taxInputs(planned.registered.map((v, i) => v + peopleYear[i].registeredWithdrawals), deductible, planned.gains)))
            applyWithdrawal(planned)
            recordWithdrawal(planned)
            row.shortfall = Math.max(0, -cashAfter(w))
          }
        }
      }

      for (let a = 0; a < accountCount; a++) {
        const acct = c.accounts[a]
        row.contributions += contributions[a]
        if (acct.nonRegistered) acb[a] += contributions[a]
        if (owner[a] >= 0) {
          if (acct.type === 'RRSP') contributedTo.rrsp[owner[a]] += contributions[a]
          if (acct.type === 'TFSA') contributedTo.tfsa[owner[a]] += contributions[a]
        }
        if (acct.stock) {
          // Stock purchases are added at the start of the year, pro rata.
          balances[a] += contributions[a]
          syncHoldings(a)
          growStock(a, t)
        } else {
          balances[a] = calculateFutureValue(balances[a], contributions[a] / 12, accountReturn[a] / 12, 12)
        }
      }

      row.guaranteedIncome = peopleYear.reduce((s, p) => s + p.pension + p.cpp + p.oas + p.gis, 0)
      const employment = peopleYear.reduce((s, p) => s + p.employment, 0)
      row.grossIncome = row.guaranteedIncome + row.otherIncome + employment + row.withdrawal - row.reinvested
      row.afterTaxIncome = Math.max(0, row.grossIncome - row.tax - payrollTotal() + withheld)
    } else {
      // The first-year withdrawal is set from the whole portfolio, before
      // any reserved one-time pot comes out (as in the original engine).
      if (t === D) strategy.initialWithdrawal = (sum(balances) / k) * strategy.initialRate

      // Simple mode: the reserved one-time pot comes out first, pro rata.
      if (oneTimePot[t] > 0) {
        const pot = planWithdrawal(Math.min(sum(balances), oneTimePot[t]))
        applyWithdrawal(pot)
        row.oneTimeExpenses = sum(pot.taken)
      }

      const available = sum(balances)
      const taxableBalance = c.accounts.reduce((s, a, i) => s + (a.taxable ? balances[i] : 0), 0)

      // Withdrawal target for the year (the strategy's amount, nominal).
      let target: number
      let solvedExactly = false
      if (c.strategy === 'expenses' && v2 && detailed) {
        target = solveIncreasing(w => afterTaxCash(planWithdrawal(w)) - row.spending, 0, Math.max(available, 1))
        solvedExactly = true
      } else if (c.strategy === 'expenses' && v2) {
        // Simple mode: the target is a pre-tax income, so no tax gross-up, but
        // GIS still depends on how much taxable income is withdrawn.
        const grossCash = (w: number) => {
          const planned = planWithdrawal(w)
          const gis = sum(gisFor(taxInputs(planned.registered, noDeduction, planned.gains))) * k
          return guaranteedBeforeGis() + gis + row.otherIncome + sum(planned.taken)
        }
        target = solveIncreasing(w => grossCash(w) - row.spending, 0, Math.max(available, 1))
        // The solver stops at what is available; record the real gap.
        const unfunded = row.spending - grossCash(Math.min(target, available))
        if (unfunded > 0.5) {
          row.shortfall = unfunded
          solvedExactly = true
        }
      } else {
        const real = strategyWithdrawal(c.spendingStrategy, strategy, {
          portfolio: available / k,
          yearsRemaining: years - t,
          expectedRealReturn: c.expectedRealReturn,
          firstYear: t === D,
        })
        target = real * k
        // Flexible strategies never cut below essential spending.
        if (v2 && detailed && c.spendingStrategy.kind !== 'initialPct' && essentialNeed > 0) {
          const floor = solveIncreasing(w => afterTaxCash(planWithdrawal(w)) - essentialNeed, 0, Math.max(available, 1))
          target = Math.max(target, floor)
        }
      }

      let planned = planWithdrawal(Math.min(available, target))
      const forcedExcess = Math.max(0, sum(planned.taken) - target)

      // RRSP meltdown: top each person's taxable income up to the target with
      // extra RRSP/RRIF withdrawals and reinvest what is left after tax.
      let meltdownPlan: PlannedWithdrawal | null = null
      if (v2 && c.meltdown.enabled) {
        const inputs = taxInputs(planned.registered, noDeduction, planned.gains)
        const household = householdTax(inputs)
        const extra = zeros()
        aliveIdx.forEach((i, m) => {
          const room = c.meltdown.targetTaxableIncome * k - household.perPerson[m].taxableIncome * k
          if (room > 1) extra[i] = room
        })
        if (sum(extra) > 0) {
          const mergedTaken = planned.taken.slice()
          const extraPlan: PlannedWithdrawal = { taken: balances.map(() => 0), registered: zeros(), gains: zeros() }
          aliveIdx.forEach(i => {
            if (extra[i] <= 0) return
            const mine = (a: number) => c.accounts[a].taxable && owner[a] === i && (c.accounts[a].type === 'RRSP' || c.accounts[a].type === 'RRIF')
            const capLeft = c.accounts.map((_, a) => (mine(a) ? Math.max(0, balances[a] - mergedTaken[a]) : 0))
            const headroom = sum(capLeft)
            const take = Math.min(extra[i], headroom)
            if (take <= 0) return
            capLeft.forEach((cap, a) => {
              const amount = headroom > 0 ? (cap / headroom) * take : 0
              extraPlan.taken[a] += amount
              mergedTaken[a] += amount
            })
            extraPlan.registered[i] += take
          })
          if (sum(extraPlan.taken) > 0) meltdownPlan = extraPlan
        }
      }

      const finalPlan = meltdownPlan ? mergePlans(planned, meltdownPlan) : planned
      applyWithdrawal(finalPlan)
      recordWithdrawal(finalPlan)
      planned = finalPlan
      const withdrawal = sum(finalPlan.taken)
      if (meltdownPlan) row.meltdownWithdrawals = sum(meltdownPlan.taken)
      if (!solvedExactly) row.shortfall = Math.max(0, target - withdrawal)

      if (v2) {
        const inputs = taxInputs(finalPlan.registered, noDeduction)
        const household = householdTax(inputs)
        recordTax(household)
        recordGis(inputs)

        // Cash withdrawn beyond what the strategy needed is reinvested after
        // its share of tax.
        // The tax on that cash is the difference from taxing only what the
        // strategy needed; forced excess is attributed in proportion to each
        // person's registered withdrawals.
        const unneeded = forcedExcess + row.meltdownWithdrawals
        if (unneeded > 0) {
          const registeredTotal = Math.max(1, sum(finalPlan.registered))
          const neededRegistered = finalPlan.registered.map((v, i) =>
            Math.max(0, v - (meltdownPlan?.registered[i] ?? 0) - forcedExcess * (v / registeredTotal)))
          const neededTax = householdTax(taxInputs(neededRegistered, noDeduction)).total * k
          reinvest(unneeded - Math.max(0, row.tax - neededTax), aliveIdx[0])
        }

        if (t === D) {
          const withoutRegistered = householdTax(taxInputs(zeros(), zeros()))
          snapshot = {
            taxWithoutRegisteredWithdrawals: withoutRegistered.total * k,
            marginalRatePct: c.people.map((_, i) => {
              const m = aliveIdx.indexOf(i)
              return m < 0 ? 0 : marginalTaxRate({ ...inputs[m], pensionSplit: household.splits[m] }, taxOpts)
            }),
          }
        }
      } else {
        const tax = computeRetirementTaxSummary({
          people: peopleYear.map((p, i) => ({
            name: c.people[i].name,
            ageAtRetirement: p.age,
            pension: p.pension / k,
            cpp: p.cpp / k,
            oas: p.oas / k,
          })),
          rrspAtRetirement: taxableBalance / k,
          tfsaAtRetirement: (available - taxableBalance) / k,
          portfolioWithdrawal: withdrawal / k,
        })
        row.tax = tax.totalTax * k
        row.oasClawback = tax.oasClawback * k
        tax.perPerson.forEach((p, i) => {
          peopleYear[i].tax = p.total * k
          peopleYear[i].federal = p.federal * k
          peopleYear[i].provincial = p.quebec * k
          peopleYear[i].oasClawback = p.oasClawback * k
          peopleYear[i].registeredWithdrawals = p.rrifWithdrawal * k
          peopleYear[i].taxableIncome = p.taxableIncome * k
        })
        if (t === D) {
          snapshot = {
            taxWithoutRegisteredWithdrawals: (tax.totalTax - tax.rrspTax) * k,
            marginalRatePct: tax.perPerson.map(p => p.marginalRate),
          }
        }
      }

      row.guaranteedIncome = peopleYear.reduce((s, p) => s + p.pension + p.cpp + p.oas + p.gis, 0)
      row.grossIncome = row.guaranteedIncome + row.otherIncome + withdrawal - row.reinvested
      row.afterTaxIncome = Math.max(0, row.guaranteedIncome + row.otherIncome + withdrawal - row.tax - payrollTotal() - row.reinvested + withheld)
      if (detailed) {
        row.surplus = row.afterTaxIncome - row.spending
        if (row.surplus > 1 && solvedExactly) reinvest(row.surplus, aliveIdx[0])
        else if (row.surplus > 0 && c.savingsAccount >= 0) toSave = row.surplus
        if (solvedExactly && row.surplus < -1) row.shortfall = -row.surplus
      }

      strategy.lastWithdrawal = Math.min(target, withdrawal) / k
      strategy.lastReturn = r
      strategy.lastInflation = path.inflation[t] ?? 0

      for (let a = 0; a < accountCount; a++) {
        if (c.accounts[a].stock) growStock(a, t)
        else balances[a] *= 1 + accountReturn[a]
      }
      if (depletionOffset === null && sum(balances) <= 0 && target > 0) depletionOffset = t
    }

    // Saved surpluses are invested at year end.
    if (toSave > 0) {
      deposit(c.savingsAccount, toSave)
      row.saved = toSave
    }

    // Cash accounts have no capital gains: their cost base is their balance.
    c.accounts.forEach((a, i) => { if (a.interestOnly) acb[i] = balances[i] })

    // Homes appreciate at inflation plus their real rate.
    c.properties.forEach((prop, p) => {
      if (propertyOwned[p]) propertyValue[p] *= (1 + (path.inflation[t] ?? 0)) * (1 + prop.appreciationReal)
    })

    // Contribution room: new room arrives each January; TFSA withdrawals are
    // added back the following year.
    for (let i = 0; i < peopleCount; i++) {
      if (!Number.isNaN(rrspRoom[i])) {
        if (t > 0) {
          // Vested shares are on the T4, so they earn RRSP room like salary.
          const priorEarnings = incomeByPerson[i].employment[t - 1] + rows[t - 1].people[i].stockCompensation
          rrspRoom[i] += Math.min(LIMITS.rrspRate * priorEarnings, LIMITS.rrspMax * k)
        }
        rrspRoom[i] -= contributedTo.rrsp[i]
        peopleYear[i].rrspRoom = rrspRoom[i]
      }
      if (!Number.isNaN(tfsaRoom[i])) {
        if (t > 0 && peopleYear[i].age >= 18) tfsaRoom[i] += LIMITS.tfsaAnnual * k + priorTfsaWithdrawals[i]
        tfsaRoom[i] -= contributedTo.tfsa[i]
        peopleYear[i].tfsaRoom = tfsaRoom[i]
      }
    }
    priorTfsaWithdrawals = tfsaWithdrawals

    peopleYear.forEach((p, i) => {
      p.investmentIncome = invOrdinary[i] + invEligible[i]
      p.realizedGains = realized[i]
    })
    row.investmentIncome = sum(invOrdinary) + sum(invEligible)
    row.realizedGains = sum(realized)
    row.balancesEnd = balances.slice()
    row.stockValue = stockAccounts.reduce((s, a) => s + balances[a], 0)
    row.propertyValue = sum(propertyValue)
    row.debtBalance = sum(debtBalance)
    row.netWorth = sum(balances) + row.propertyValue - row.debtBalance
    rows.push(row)
  }

  const estate = v2 ? computeEstate(c, rows, balances, acb, propertyValue, propertyAcb, propertyOwned) : null
  return { rows, snapshot, estate, depletionOffset }
}

// Deemed disposition at the last death: registered balances are income on the
// final return and unrealized capital gains are realized; a principal
// residence is exempt. Probate applies to what passes through the estate.
function computeEstate(
  c: CompiledPlan,
  rows: YearRow[],
  balances: number[],
  acb: number[],
  propertyValue: number[],
  propertyAcb: number[],
  propertyOwned: boolean[],
): EstateResult | null {
  const last = rows[rows.length - 1]
  if (!last || c.people.length === 0) return null
  // The last survivor (latest life expectancy).
  const lastIndex = c.people.reduce((best, p, i) => (p.endOffset > c.people[best].endOffset ? i : best), 0)
  const person = c.people[lastIndex]
  const k = last.cpiEnd

  const registered = c.accounts.reduce((s, a, i) => s + (a.taxable ? balances[i] : 0), 0)
  const securitiesGains = c.accounts.reduce((s, a, i) => s + (a.nonRegistered ? Math.max(0, balances[i] - acb[i]) : 0), 0)
  const propertyGains = c.properties.reduce((s, p, i) => s + (propertyOwned[i] && !p.principalResidence ? Math.max(0, propertyValue[i] - propertyAcb[i]) : 0), 0)
  const gross = last.netWorth

  // Incremental tax over the final year's other income, in plan-start dollars.
  const baseIncome = last.people[lastIndex].taxableIncome / last.cpi
  const age = last.people[lastIndex].age
  const base = computeIncomeTax({ ...emptyIncome(person.province, age), otherOrdinary: baseIncome }, { deflator: 1 / k })
  const withDeemed = computeIncomeTax({
    ...emptyIncome(person.province, age),
    otherOrdinary: baseIncome + registered / k,
    capitalGains: (securitiesGains + propertyGains) / k,
  }, { deflator: 1 / k })
  const finalReturnTax = Math.max(0, withDeemed.total - base.total) * k
  const probate = c.probate ? probateFee(person.province, Math.max(0, gross - finalReturnTax)) : 0

  return {
    year: last.year,
    cpi: k,
    grossEstate: gross,
    finalReturnTax,
    probate,
    afterTaxEstate: Math.max(0, gross - finalReturnTax - probate),
  }
}
