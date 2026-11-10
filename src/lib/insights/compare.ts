import type { PlanV2 } from '@/lib/plan/schema'
import type { CompiledPlan, SimResult } from '@/lib/sim/types'
import { compilePlan } from '@/lib/sim/compile'
import { simulate } from '@/lib/sim/simulate'
import { planPath } from '@/lib/sim/paths/deterministic'
import { evaluateFunding } from '@/lib/sim/funding'

export interface PlanComparison {
  id: string
  name: string
  retirementYear: number
  portfolioAtRetirement: number // real
  averageRetirementIncome: number // real, after tax
  lifetimeTax: number // real
  depletionYear: number | null
  afterTaxEstate: number // real
  onTrack: boolean
  netWorth: { year: number; value: number }[] // real, end of year
}

// Headline numbers for one simulated plan, all in today's dollars.
export function planMetrics(plan: PlanV2, c: CompiledPlan, result: SimResult): PlanComparison {
  const rows = result.rows
  const D = c.drawdownStartOffset
  const retired = rows.slice(D)
  const atRetirement = rows[D]
  const funding = evaluateFunding(c, result)
  return {
    id: plan.id,
    name: plan.name,
    retirementYear: c.startYear + D,
    portfolioAtRetirement: atRetirement ? atRetirement.balancesStart.reduce((s, b) => s + b, 0) / atRetirement.cpi : 0,
    // A partial first year counts for only the part of a year it covers.
    averageRetirementIncome: retired.length
      ? retired.reduce((s, r) => s + r.afterTaxIncome / r.cpi, 0) / retired.reduce((s, r) => s + r.periodFraction, 0)
      : 0,
    lifetimeTax: rows.reduce((s, r) => s + r.tax / r.cpi, 0) + (result.estate ? result.estate.finalReturnTax / result.estate.cpi : 0),
    depletionYear: funding.firstShortfall?.year ?? null,
    afterTaxEstate: result.estate ? result.estate.afterTaxEstate / result.estate.cpi : 0,
    onTrack: funding.funded && !funding.needsTarget,
    netWorth: rows.map(r => ({ year: r.year, value: r.netWorth / r.cpiEnd })),
  }
}

// Deterministic headline numbers for each plan.
export function comparePlans(plans: PlanV2[], startYear: number): PlanComparison[] {
  return plans.map(plan => {
    const c = compilePlan(plan, { startYear })
    return planMetrics(plan, c, simulate(c, planPath(c)))
  })
}
