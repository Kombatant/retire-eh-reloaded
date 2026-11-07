import type { ExpenseItem, GrowthRule, IncomeStream, PlanV2, TimePoint } from '@/lib/plan/schema'
import { resolveYear } from '@/lib/plan/time'
import { cppAmountAt65 } from '@/lib/plan/legacy-view'
import type { CompiledAccount, CompiledExpense, CompiledFlow, CompiledIncome, CompiledPerson, CompiledPlan, RuleSet } from './types'

const TAXABLE_ACCOUNT_TYPES = new Set(['RRSP', 'RRIF', 'LIRA', 'LIF'])

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
    cppAt65: cppAmountAt65(p),
    cppStartAge: p.cppStartAge,
    oasStartAge: p.oas.startAge,
    province: p.province,
    yearsInCanadaAfter18: p.oas.yearsInCanadaAfter18,
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
    }
  })

  // Reinvested RRSP refunds are after-tax cash, so they land in the owner's
  // TFSA. People without a TFSA get a synthetic one to receive them.
  // v1 used a flat marginal rate; v2 computes the refund with the tax engine.
  const refundTargets = people.map(() => -1)
  if (plan.assumptions.reinvestRrspRefund) {
    const flatRate = plan.assumptions.workingMarginalTaxRate / 100
    people.forEach((person, idx) => {
      const rrspFlows = accounts
        .filter(a => a.ownerIndex === idx && a.type === 'RRSP')
        .flatMap(a => a.contributions)
        .filter(flow => flow.amount > 0)
      if (rrspFlows.length === 0) return
      if (rules === 'v1' && flatRate <= 0) return
      let targetIndex = accounts.findIndex(a => a.ownerIndex === idx && a.type === 'TFSA')
      if (targetIndex < 0) {
        accounts.push({
          id: `${person.id}-refund-tfsa`, type: 'TFSA', ownerIndex: idx, taxable: false,
          initialBalance: 0, contributions: [], synthetic: true,
        })
        targetIndex = accounts.length - 1
      }
      if (rules === 'v1') {
        accounts[targetIndex].contributions.push(...rrspFlows.map(flow => ({ ...flow, amount: flow.amount * flatRate })))
      } else {
        refundTargets[idx] = targetIndex
      }
    })
  }

  const incomes: CompiledIncome[] = plan.incomes.flatMap(stream => {
    const owner = personIndex.get(stream.ownerId)
    if (owner === undefined) return []
    return [{ personIndex: owner, kind: stream.kind, taxTreatment: stream.taxTreatment, flow: incomeFlow(stream, offsetOf, years) }]
  })

  const expenses: CompiledExpense[] = plan.expenses.items.map(item => ({
    id: item.id,
    category: item.category,
    essential: item.essential,
    oneTime: item.frequency === 'oneTime',
    flow: expenseFlow(item, offsetOf, years),
  }))

  const strategy = plan.drawdown.strategy
  return {
    rules,
    startYear,
    years,
    drawdownStartOffset,
    people,
    accounts,
    incomes,
    expenses,
    initialWithdrawalRatePct: strategy.kind === 'initialPct' ? strategy.ratePct : 4,
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
    basis: 'real',
    ratePct: item.realGrowthPct,
    everyN: item.frequency === 'everyNYears' ? (item.everyNYears ?? 1) : 1,
  }
}
