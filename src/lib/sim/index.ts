export { compilePlan } from './compile'
export { simulate, cumulativeCpi, flowSeries } from './simulate'
export { deterministicPath } from './paths/deterministic'
export { toProjectionData, toCashFlowRows, householdBaseAge, type CashFlowRow } from './legacyAdapter'
export type * from './types'

import type { PlanV2 } from '@/lib/plan/schema'
import { compilePlan } from './compile'
import { simulate } from './simulate'
import { deterministicPath } from './paths/deterministic'
import type { SimResult, CompiledPlan } from './types'

// Convenience: compile + simulate at the plan's own expected return/inflation.
export function simulatePlan(
  plan: PlanV2,
  opts: { startYear: number; returnPct?: number; inflationPct?: number; rules?: 'v1' | 'v2' },
): { compiled: CompiledPlan; result: SimResult } {
  const compiled = compilePlan(plan, { startYear: opts.startYear, rules: opts.rules })
  const path = deterministicPath(
    compiled.years,
    opts.returnPct ?? compiled.expectedReturnPct,
    opts.inflationPct ?? compiled.inflationPct,
  )
  return { compiled, result: simulate(compiled, path) }
}
