import { simulate } from '@/lib/sim/simulate'
import { deterministicPath } from '@/lib/sim/paths/deterministic'
import { householdBaseAge } from '@/lib/sim/legacyAdapter'
import { yearFellShort } from '@/lib/sim/failures'
import type { CompiledPlan } from '@/lib/sim/types'
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

function stepFor(spending: number): number {
  const ideal = spending * STEP_SHARE
  return STEPS.reduce((best, step) => (Math.abs(step - ideal) < Math.abs(best - ideal) ? step : best))
}

// The plan with spending set to `spending` and withdrawals following it. Other
// strategies set withdrawals by a rate, which would leave every line the same.
function compileAt(c: CompiledPlan, planSpending: number, spending: number): CompiledPlan {
  const funded: CompiledPlan = { ...c, strategy: 'expenses', spendingStrategy: { kind: 'expenses' } }
  if (c.expenseMode !== 'detailed') return { ...funded, simpleSpendingTarget: spending }
  // A flat change keeps the budget's shape: a mortgage that ends or spending
  // that tapers still does. Essential, so spending phases don't scale it.
  return {
    ...funded,
    expenses: [...c.expenses, {
      id: 'spending-level',
      category: 'general',
      essential: true,
      oneTime: false,
      flow: { startOffset: c.drawdownStartOffset, endOffset: c.years, amount: spending - planSpending, basis: 'real', ratePct: 0, everyN: 1 },
    }],
  }
}

export function buildSpendingLevels(c: CompiledPlan, returnPct: number, showRealValues: boolean): SpendingLevels | null {
  if (c.drawdownStartOffset >= c.years) return null
  const path = deterministicPath(c.years, returnPct, c.inflationPct)
  const planSpending = retirementSpendingTarget(c, simulate(c, path))
  if (planSpending <= 0) return null

  const run = (spending: number) => simulate(compileAt(c, planSpending, spending), path)
  const baseAge = householdBaseAge(c)
  const toLevel = (spending: number, isPlan = false): SpendingLevel => {
    const result = run(spending)
    return {
      spending,
      isPlan,
      balances: buildAccountBreakdown(c, result, showRealValues).filter(r => r.phase === 'drawdown').map(r => r.balanceTotal),
      runsOutAtAge: result.depletionOffset === null ? null : baseAge + result.depletionOffset,
    }
  }

  const step = stepFor(planSpending)
  const levels = OFFSETS
    .map(n => planSpending + n * step)
    .filter(spending => spending > 0)
    .map(spending => toLevel(spending, spending === planSpending))

  return {
    ages: Array.from({ length: c.years - c.drawdownStartOffset }, (_, i) => baseAge + c.drawdownStartOffset + i),
    levels,
    highestSustainable: findHighestSustainable(c, planSpending, run, toLevel),
  }
}

function findHighestSustainable(
  c: CompiledPlan,
  planSpending: number,
  run: (spending: number) => ReturnType<typeof simulate>,
  toLevel: (spending: number) => SpendingLevel,
): SpendingLevel | null {
  // Only retirement years: a shortfall while working happens at any level.
  const lasts = (spending: number) => !run(spending).rows.slice(c.drawdownStartOffset).some(yearFellShort)
  if (!lasts(0)) return null

  let low = 0
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
