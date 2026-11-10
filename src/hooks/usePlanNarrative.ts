import { usePeople } from '@/contexts/PeopleContext'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { useAssumptions } from '@/contexts/AssumptionsContext'
import { useProjectionContext } from '@/contexts/ProjectionContext'
import { usePlanOutlook } from '@/hooks/usePlanOutlook'
import { buildPlanNarrative } from '@/lib/narrative'
import { jurisdictionLabel } from '@/lib/tax'

export function usePlanNarrative() {
  const { people } = usePeople()
  const { activePlan } = usePlanStore()
  const assumptions = useAssumptions()
  const projection = useProjectionContext()

  const { goal, outlook } = usePlanOutlook()

  const tax = projection.retirementTax
  const effectiveTaxRate = tax?.effectiveRrspTaxRate ?? 0
  const useAfterTax = effectiveTaxRate > 0
  const gap = useAfterTax ? goal.afterTaxGap : goal.gap
  const progress = useAfterTax ? goal.afterTaxProgress : goal.progress
  const additionalAnnualSavings = useAfterTax
    ? goal.afterTaxAdditionalAnnualSavings
    : goal.additionalAnnualSavings
  const portfolioWithdrawal = goal.portfolioAfterGifts * (assumptions.withdrawalRate / 100)
  const guaranteedAnnualIncome = Math.max(0, goal.projectedAnnualIncome - portfolioWithdrawal)

  const narrative = buildPlanNarrative({
    people: people.map(p => ({
      name: p.name,
      currentAge: p.currentAge,
      retirementAge: p.retirementAge,
    })),
    totalPortfolio: projection.totalPortfolio,
    totalAnnualContributions: projection.totalAnnualContributions,
    totalAnnualIncome: projection.totalAnnualIncome,
    householdRetirementAge: projection.householdRetirementAge,
    yearsToRetirement: projection.yearsToRetirement,
    expectedReturn: assumptions.expectedReturn,
    inflationRate: assumptions.inflationRate,
    spendingMode: activePlan.expenses.mode,
    replacementRate: assumptions.replacementRate,
    withdrawalRate: assumptions.withdrawalRate,
    showRealValues: assumptions.showRealValues,
    giftTotal: goal.giftTotal,
    portfolioAtRetirement: goal.portfolioAtRetirement,
    propertySaleValue: goal.propertySaleValue,
    requiredPortfolio: goal.requiredPortfolio,
    requiredAnnualIncome: goal.requiredAnnualIncome,
    projectedAnnualIncome: goal.projectedAnnualIncome,
    afterTaxAnnualIncome: tax?.afterTaxIncome ?? goal.afterTaxProjectedAnnualIncome,
    guaranteedAnnualIncome,
    portfolioWithdrawal,
    onTrack: outlook.onTrack,
    needsTarget: outlook.needsTarget,
    progress,
    gap,
    additionalAnnualSavings,
    taxTotal: tax?.totalTax,
    taxJurisdiction: tax ? jurisdictionLabel(tax.perPerson.map(p => p.province)) : undefined,
    oasClawback: tax?.oasClawback,
  })

  return { narrative, showRealValues: assumptions.showRealValues }
}
