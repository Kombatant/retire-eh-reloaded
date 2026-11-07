import type { PlanV2 } from '@/lib/plan/schema'
import { compilePlan } from '@/lib/sim/compile'
import { simulate } from '@/lib/sim/simulate'
import { deterministicPath } from '@/lib/sim/paths/deterministic'
import { runSucceeded } from '@/lib/sim/risk'

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

// Deterministic headline numbers for each plan, all in today's dollars.
export function comparePlans(plans: PlanV2[], startYear: number): PlanComparison[] {
  return plans.map(plan => {
    const c = compilePlan(plan, { startYear })
    const result = simulate(c, deterministicPath(c.years, c.expectedReturnPct, c.inflationPct))
    const rows = result.rows
    const D = c.drawdownStartOffset
    const retired = rows.slice(D)
    const atRetirement = rows[D]
    return {
      id: plan.id,
      name: plan.name,
      retirementYear: startYear + D,
      portfolioAtRetirement: atRetirement ? atRetirement.balancesStart.reduce((s, b) => s + b, 0) / atRetirement.cpi : 0,
      averageRetirementIncome: retired.length ? retired.reduce((s, r) => s + r.afterTaxIncome / r.cpi, 0) / retired.length : 0,
      lifetimeTax: rows.reduce((s, r) => s + r.tax / r.cpi, 0) + (result.estate ? result.estate.finalReturnTax / result.estate.cpi : 0),
      depletionYear: result.depletionOffset === null ? null : startYear + result.depletionOffset,
      afterTaxEstate: result.estate ? result.estate.afterTaxEstate / result.estate.cpi : 0,
      onTrack: runSucceeded(result),
      netWorth: rows.map(r => ({ year: r.year, value: r.netWorth / r.cpiEnd })),
    }
  })
}
