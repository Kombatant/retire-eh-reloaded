import { cumulativeCpi, flowSeries, simulate } from '@/lib/sim/simulate'
import { planPath } from '@/lib/sim/paths/deterministic'
import { householdBaseAge } from '@/lib/sim/legacyAdapter'
import { evaluateFunding, yearFellShort } from '@/lib/sim/funding'
import type { CompiledPlan, MarketPath, SimResult } from '@/lib/sim/types'
import { buildAccountBreakdown } from './accountBreakdown'
import { retirementSpendingTarget } from './outlook'

// What spending more or less each year does to savings in retirement. Each
// level is a full simulation, so benefits, tax and required minimums all count.

export interface SpendingLevel {
  // Per year in today's dollars: first-year spending, in the plan's own terms
  // (after tax for a budget, before tax for a replacement target).
  spending: number
  isPlan: boolean
  // Start-of-year savings for each entry of `ages`.
  balances: number[]
  // Age when savings run out and the year can't be paid for; null if they last.
  runsOutAtAge: number | null
}

export interface SpendingLevels {
  ages: number[]
  // Lowest spending first.
  levels: SpendingLevel[]
  // The most the plan can spend and still pay for every retirement year; null
  // when even spending nothing falls short, or no amount tested does.
  highestSustainable: SpendingLevel | null
}

const STEPS = [1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000]
const OFFSETS = [-2, -1, 0, 1, 2]
// Levels sit about an eighth of the plan's spending apart, so the lowest line
// is still a realistic amount to live on.
const STEP_SHARE = 1 / 8
const SEARCH_PRECISION = 100
const MAX_DOUBLINGS = 8

function firstShortAge(offset: number | undefined, retirementOffset: number, baseAge: number): number | null {
  return offset === undefined || offset < retirementOffset ? null : baseAge + offset
}

function stepFor(spending: number): number {
  const ideal = spending * STEP_SHARE
  return STEPS.reduce((best, step) => (Math.abs(step - ideal) < Math.abs(best - ideal) ? step : best))
}

// Spending in the first retirement year that can't be scaled: debt payments,
// property costs and one-time items. The rest is recurring spending.
function recurringAtRetirement(c: CompiledPlan, path: MarketPath, result: SimResult): number {
  const D = c.drawdownStartOffset
  const row = result.rows[D]
  const cpi = cumulativeCpi(path.inflation, c.years)
  let multiplier = 1
  for (const phase of [...c.phases].sort((x, y) => x.startOffset - y.startOffset)) {
    if (D >= phase.startOffset && D < phase.endOffset) multiplier = phase.multiplier
  }
  return c.expenses.reduce((total, e) => {
    if (e.oneTime) return total
    const value = flowSeries(e.flow, cpi, path.inflation)[D]
    return total + value * (e.essential ? 1 : multiplier)
  }, 0) / row.cpi
}

// The plan with recurring spending scaled to reach `spending` in the first
// retirement year, and withdrawals following it. Other strategies set withdrawals
// by a rate, which would leave every line the same. Scaling only the recurring
// items leaves debts and one-time costs as they are and keeps every item positive.
function compileAt(c: CompiledPlan, recurring: number, fixed: number, spending: number): CompiledPlan {
  const funded: CompiledPlan = { ...c, strategy: 'expenses', spendingStrategy: { kind: 'expenses' } }
  if (c.expenseMode !== 'detailed') return { ...funded, simpleSpendingTarget: spending }
  const factor = recurring > 0 ? Math.max(0, spending - fixed) / recurring : 1
  return {
    ...funded,
    expenses: c.expenses.map(e => (e.oneTime ? e : { ...e, flow: { ...e.flow, amount: e.flow.amount * factor } })),
  }
}

export function buildSpendingLevels(c: CompiledPlan, returnPct: number, showRealValues: boolean): SpendingLevels | null {
  if (c.drawdownStartOffset >= c.years) return null
  const path = planPath(c, returnPct)
  const base = simulate(c, path)
  const planSpending = retirementSpendingTarget(c, base)
  if (planSpending <= 0) return null
  const recurring = c.expenseMode === 'detailed' ? recurringAtRetirement(c, path, base) : planSpending
  const fixed = Math.max(0, planSpending - recurring)
  // Nothing to scale in this plan: every yearly level would be the same.
  if (c.expenseMode === 'detailed' && recurring <= 0) return null

  const run = (spending: number) => simulate(compileAt(c, recurring, fixed, spending), path)
  const baseAge = householdBaseAge(c)
  const toLevel = (spending: number, isPlan = false): SpendingLevel => {
    const result = run(spending)
    return {
      spending,
      isPlan,
      balances: buildAccountBreakdown(c, result, showRealValues).filter(r => r.phase === 'drawdown').map(r => r.balanceTotal),
      runsOutAtAge: firstShortAge(evaluateFunding(c, result).firstShortfall?.offset, c.drawdownStartOffset, baseAge),
    }
  }

  const step = stepFor(planSpending)
  const levels = OFFSETS
    .map(n => planSpending + n * step)
    // A level below the commitments that can't be cut isn't a real choice.
    .filter(spending => spending > 0 && spending >= fixed)
    .map(spending => toLevel(spending, spending === planSpending))

  return {
    ages: Array.from({ length: c.years - c.drawdownStartOffset }, (_, i) => baseAge + c.drawdownStartOffset + i),
    levels,
    highestSustainable: findHighestSustainable(c, planSpending, fixed, run, toLevel),
  }
}

function findHighestSustainable(
  c: CompiledPlan,
  planSpending: number,
  fixed: number,
  run: (spending: number) => ReturnType<typeof simulate>,
  toLevel: (spending: number) => SpendingLevel,
): SpendingLevel | null {
  // Only retirement years: a shortfall while working happens at any level.
  const lasts = (spending: number) => !run(spending).rows.slice(c.drawdownStartOffset).some(yearFellShort)
  if (!lasts(fixed)) return null

  let low = fixed
  let high = planSpending * 2
  for (let doublings = 0; lasts(high); doublings++) {
    if (doublings === MAX_DOUBLINGS) return null
    low = high
    high *= 2
  }
  while (high - low > SEARCH_PRECISION) {
    const middle = (low + high) / 2
    if (lasts(middle)) low = middle
    else high = middle
  }
  return toLevel(Math.floor(low / SEARCH_PRECISION) * SEARCH_PRECISION)
}
