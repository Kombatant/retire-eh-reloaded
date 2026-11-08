import { useMemo } from 'react'
import type { ProjectionDataPoint } from '@/types/household'
import { calculateRetirementGoalWithIncome, type PlannedGiftLite, type RetirementGoalWithIncome } from '@/lib/calculations'

interface UseRetirementGoalParams {
  currentProjectionData: ProjectionDataPoint[]
  annualSpendingTarget: number
  annualPension: number
  guaranteedIncomeSchedule?: number[]
  propertySaleSchedule?: number[]
  withdrawalRate: number
  yearsToRetirement: number
  expectedReturn: number
  inflationRate: number
  currentAnnualContributions: number
  currentPortfolio: number
  showRealValues?: boolean
  plannedGifts?: PlannedGiftLite[]
  effectiveTaxRate?: number
}

export function useRetirementGoal({
  currentProjectionData,
  annualSpendingTarget,
  annualPension,
  guaranteedIncomeSchedule = [],
  propertySaleSchedule = [],
  withdrawalRate,
  yearsToRetirement,
  expectedReturn,
  inflationRate,
  currentAnnualContributions,
  currentPortfolio,
  showRealValues = true,
  plannedGifts = [],
  effectiveTaxRate = 0,
}: UseRetirementGoalParams): RetirementGoalWithIncome {
  return useMemo(
    () => calculateRetirementGoalWithIncome({
      currentProjectionData,
      annualSpendingTarget,
      annualPension,
      guaranteedIncomeSchedule,
      propertySaleSchedule,
      withdrawalRate,
      yearsToRetirement,
      expectedReturn,
      inflationRate,
      currentAnnualContributions,
      currentPortfolio,
      showRealValues,
      plannedGifts,
      effectiveTaxRate,
    }),
    [currentProjectionData, annualSpendingTarget, annualPension, guaranteedIncomeSchedule, propertySaleSchedule, withdrawalRate, yearsToRetirement, expectedReturn, inflationRate, currentAnnualContributions, currentPortfolio, showRealValues, plannedGifts, effectiveTaxRate],
  )
}

