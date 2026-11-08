import type { PlanV2 } from '@/lib/plan/schema'
import { compilePlan } from '@/lib/sim/compile'
import { simulate } from '@/lib/sim/simulate'
import { deterministicPath } from '@/lib/sim/paths/deterministic'
import { runSucceeded } from '@/lib/sim/risk'
import { resolveYear } from '@/lib/plan/time'

// FI is judged against what the household needs to spend (the budget, or the
// simple-mode income target), not against a fixed withdrawal rate, which
// always "succeeds" no matter how small the portfolio.
// `simpleTarget` holds the simple-mode income goal steady: it comes from the
// final salary, and retiring in the very first years would otherwise leave no
// salary to measure and an imaginary goal of zero.
function succeeds(plan: PlanV2, startYear: number, simpleTarget?: number): boolean {
  const compiled = compilePlan({ ...plan, drawdown: { ...plan.drawdown, strategy: { kind: 'expenses' } } }, { startYear })
  const c = simpleTarget === undefined ? compiled : { ...compiled, simpleSpendingTarget: simpleTarget }
  return runSucceeded(simulate(c, deterministicPath(c.years, c.expectedReturnPct, c.inflationPct)))
}

// Smallest k in [lo, hi] for which test(k) holds. A linear scan, because dated
// events (windfalls, sales, benefit starts) can make success non-monotonic.
function firstTrue(lo: number, hi: number, test: (k: number) => boolean): number | null {
  for (let k = lo; k <= hi; k++) if (test(k)) return k
  return null
}

export function withRetirementIn(plan: PlanV2, year: number): PlanV2 {
  return {
    ...plan,
    people: plan.people.map(p => ({ ...p, retirementAge: Math.min(p.retirementAge, Math.max(0, year - p.birthYear)) })),
  }
}

// Stops contributions at `year` at the latest: one already due to end sooner
// keeps its own end date.
export function withContributionsStoppingIn(plan: PlanV2, year: number, startYear = year): PlanV2 {
  const retirementYear = (ownerId: string) => {
    const owner = plan.people.find(p => p.id === ownerId)
    return owner ? owner.birthYear + owner.retirementAge : year
  }
  return {
    ...plan,
    accounts: plan.accounts.map(a => ({
      ...a,
      contributions: a.contributions.map(rule => {
        const existing = resolveYear(rule.to, plan.people, startYear, retirementYear(a.ownerId))
        return { ...rule, to: { kind: 'year' as const, year: Math.min(existing, year) } }
      }),
    })),
  }
}

export interface FiMetrics {
  // The plan works (average markets) as planned.
  onTrack: boolean
  // Earliest year everyone could retire and still fund the plan.
  fiYear: number | null
  // Earliest year contributions could stop (working until the planned
  // retirement, without saving more) and the plan still works.
  coastYear: number | null
}

// Financial independence dates found by re-running the deterministic plan
// with earlier retirement (FI) or earlier last contribution (Coast FI).
export function fiMetrics(plan: PlanV2, startYear: number): FiMetrics {
  const lastRetirement = Math.max(...plan.people.map(p => p.birthYear + p.retirementAge))
  const horizon = Math.max(0, lastRetirement - startYear)
  const onTrack = succeeds(plan, startYear)
  if (!onTrack) return { onTrack, fiYear: null, coastYear: null }
  const target = compilePlan(plan, { startYear }).simpleSpendingTarget
  const fiOffset = firstTrue(0, horizon, k => succeeds(withRetirementIn(plan, startYear + k), startYear, target))
  const coastOffset = firstTrue(0, horizon, k => succeeds(withContributionsStoppingIn(plan, startYear + k, startYear), startYear, target))
  return {
    onTrack,
    fiYear: fiOffset === null ? null : startYear + fiOffset,
    coastYear: coastOffset === null ? null : startYear + coastOffset,
  }
}
