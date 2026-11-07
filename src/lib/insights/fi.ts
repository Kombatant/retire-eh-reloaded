import type { PlanV2 } from '@/lib/plan/schema'
import { compilePlan } from '@/lib/sim/compile'
import { simulate } from '@/lib/sim/simulate'
import { deterministicPath } from '@/lib/sim/paths/deterministic'
import { runSucceeded } from '@/lib/sim/risk'

// FI is judged against what the household needs to spend (the budget, or the
// simple-mode income target), not against a fixed withdrawal rate, which
// always "succeeds" no matter how small the portfolio.
function succeeds(plan: PlanV2, startYear: number): boolean {
  const c = compilePlan({ ...plan, drawdown: { ...plan.drawdown, strategy: { kind: 'expenses' } } }, { startYear })
  return runSucceeded(simulate(c, deterministicPath(c.years, c.expectedReturnPct, c.inflationPct)))
}

// Smallest k in [lo, hi] for which test(k) holds, assuming it stays true once true.
function firstTrue(lo: number, hi: number, test: (k: number) => boolean): number | null {
  if (!test(hi)) return null
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (test(mid)) hi = mid
    else lo = mid + 1
  }
  return lo
}

export function withRetirementIn(plan: PlanV2, year: number): PlanV2 {
  return {
    ...plan,
    people: plan.people.map(p => ({ ...p, retirementAge: Math.min(p.retirementAge, Math.max(0, year - p.birthYear)) })),
  }
}

export function withContributionsStoppingIn(plan: PlanV2, year: number): PlanV2 {
  return {
    ...plan,
    accounts: plan.accounts.map(a => ({
      ...a,
      contributions: a.contributions.map(rule => ({ ...rule, to: { kind: 'year' as const, year } })),
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
  const fiOffset = firstTrue(0, horizon, k => succeeds(withRetirementIn(plan, startYear + k), startYear))
  const coastOffset = firstTrue(0, horizon, k => succeeds(withContributionsStoppingIn(plan, startYear + k), startYear))
  return {
    onTrack,
    fiYear: fiOffset === null ? null : startYear + fiOffset,
    coastYear: coastOffset === null ? null : startYear + coastOffset,
  }
}
