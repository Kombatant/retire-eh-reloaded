import { useMemo } from 'react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { useAssumptions } from '@/contexts/AssumptionsContext'
import { useProjectionContext } from '@/contexts/ProjectionContext'
import { getPortfolioAtRetirement } from '@/lib/calculations'
import { moneyLasts, planGoalOutlook } from '@/lib/insights/outlook'

// Everything the headline views need: the goal, whether the plan is on track,
// retirement income, and how long the money lasts. Recomputed on every edit.
export function usePlanOutlook() {
  const { activePlan, nowYear } = usePlanStore()
  const assumptions = useAssumptions()
  const projection = useProjectionContext()
  const { goal, outlook } = useMemo(
    () => planGoalOutlook(activePlan, projection.compiledPlan, projection.simulation, nowYear, assumptions.showRealValues),
    [activePlan, projection.compiledPlan, projection.simulation, nowYear, assumptions.showRealValues],
  )
  const lasts = useMemo(
    () => moneyLasts(activePlan, projection.compiledPlan, projection.simulation),
    [activePlan, projection.compiledPlan, projection.simulation],
  )

  const estate = projection.simulation.estate
  const estateValue = estate ? estate.afterTaxEstate * (assumptions.showRealValues ? 1 / estate.cpi : 1) : null

  return {
    goal,
    outlook,
    // A detailed budget is money to spend; a simple target is income before tax.
    goalIsAfterTax: activePlan.expenses.mode === 'detailed',
    lasts,
    estateValue,
    estateYear: estate?.year ?? null,
    portfolioToday: projection.totalPortfolio,
    portfolioAtRetirement: getPortfolioAtRetirement(projection.currentProjectionData),
    retirementAge: projection.householdRetirementAge,
    yearsToRetirement: projection.yearsToRetirement,
    showRealValues: assumptions.showRealValues,
  }
}
