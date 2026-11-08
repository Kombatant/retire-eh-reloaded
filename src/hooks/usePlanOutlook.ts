import { useMemo } from 'react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { useAssumptions } from '@/contexts/AssumptionsContext'
import { useProjectionContext } from '@/contexts/ProjectionContext'
import { useRetirementGoal } from '@/hooks/useRetirementGoal'
import { getPortfolioAtRetirement } from '@/lib/calculations'
import { moneyLasts, retirementOutlook } from '@/lib/insights/outlook'

// Everything the headline views need: the goal, whether the plan is on track,
// retirement income, and how long the money lasts. Recomputed on every edit.
export function usePlanOutlook() {
  const { activePlan } = usePlanStore()
  const assumptions = useAssumptions()
  const projection = useProjectionContext()
  const tax = projection.retirementTax
  const guaranteed = projection.totalAnnualPension + projection.totalAnnualCpp + projection.totalAnnualOas

  const goal = useRetirementGoal({
    currentProjectionData: projection.currentProjectionData,
    annualIncome: projection.totalAnnualIncome,
    annualPension: guaranteed,
    guaranteedIncomeSchedule: projection.guaranteedIncomeSchedule,
    replacementRate: assumptions.replacementRate,
    withdrawalRate: assumptions.withdrawalRate,
    yearsToRetirement: projection.yearsToRetirement,
    expectedReturn: assumptions.expectedReturn,
    inflationRate: assumptions.inflationRate,
    currentAnnualContributions: projection.totalAnnualContributions,
    currentPortfolio: projection.totalPortfolio,
    showRealValues: assumptions.showRealValues,
    plannedGifts: assumptions.plannedGifts,
    effectiveTaxRate: tax?.effectiveRrspTaxRate,
  })

  const outlook = useMemo(
    () => retirementOutlook(goal, { effectiveTaxRate: tax?.effectiveRrspTaxRate, afterTaxAnnualIncome: tax?.afterTaxIncome, taxSummary: tax }),
    [goal, tax],
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
