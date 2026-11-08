import type { RetirementGoalResult } from '@/lib/calculations'
import type { RetirementTaxSnapshot } from '@/lib/sim/taxSnapshot'
import type { PlanV2 } from '@/lib/plan/schema'
import type { CompiledPlan, SimResult } from '@/lib/sim/types'
import { youngestPerson } from '@/lib/plan/time'

// The headline answer to "am I on track?", shared by the Plan live rail and
// the Dashboard so both always show the same numbers.
export interface RetirementOutlook {
  onTrack: boolean
  // Progress towards the goal. With tax known, the weaker of the pre-tax and
  // after-tax measures, since being on track requires both.
  progressPct: number
  // Which measure progressPct is: the after-tax one is used when it is lower.
  progressBasis: 'preTax' | 'afterTax'
  preTaxIncome: number
  afterTaxIncome: number
  estimatedTax: number | null
  // Extra yearly saving that would close the gap (0 when on track).
  extraSavingsNeeded: number
}

export function retirementOutlook(
  goal: RetirementGoalResult & { projectedAnnualIncome: number; afterTaxProjectedAnnualIncome: number },
  opts: { effectiveTaxRate?: number; afterTaxAnnualIncome?: number; taxSummary?: RetirementTaxSnapshot | null },
): RetirementOutlook {
  const taxAware = opts.effectiveTaxRate !== undefined && opts.effectiveTaxRate > 0
  const onTrack = goal.progress >= 100 && (taxAware ? goal.afterTaxProgress >= 100 : true)
  const tax = opts.taxSummary

  // The goal values delayed CPP/OAS by levelizing the benefit stream. Keep the
  // after-tax figure on the same basis by applying the average tax rate to the
  // difference between levelized and retirement-year income.
  const afterTaxIncome = tax
    ? Math.max(0, tax.afterTaxIncome + (goal.projectedAnnualIncome - tax.preTaxIncome) * (1 - tax.averageTaxRate / 100))
    : (opts.afterTaxAnnualIncome ?? goal.afterTaxProjectedAnnualIncome)

  return {
    onTrack,
    progressPct: taxAware ? Math.min(goal.progress, goal.afterTaxProgress) : goal.progress,
    progressBasis: taxAware && goal.afterTaxProgress < goal.progress ? 'afterTax' : 'preTax',
    preTaxIncome: goal.projectedAnnualIncome,
    afterTaxIncome,
    estimatedTax: tax ? Math.max(0, goal.projectedAnnualIncome - afterTaxIncome) : null,
    extraSavingsNeeded: onTrack ? 0 : Math.max(goal.additionalAnnualSavings, taxAware ? goal.afterTaxAdditionalAnnualSavings : 0),
  }
}

export type IncomeSourceKey = 'withdrawals' | 'cpp' | 'oas' | 'pension'

export interface IncomeSource {
  key: IncomeSourceKey
  amount: number
}

// Where first-year retirement income comes from, on the same basis as the
// goal: a sustainable withdrawal from savings (after reserved gifts) plus
// guaranteed income. In future-dollar mode, guaranteed income is inflated
// to retirement-year dollars so it adds up with the nominal portfolio.
export function retirementIncomeSources(input: {
  portfolioAfterGifts: number
  withdrawalRatePct: number
  annualCpp: number
  annualOas: number
  annualPension: number
  showRealValues: boolean
  inflationRatePct: number
  yearsToRetirement: number
}): IncomeSource[] {
  const inflate = input.showRealValues ? 1 : Math.pow(1 + input.inflationRatePct / 100, Math.max(0, input.yearsToRetirement))
  const sources: IncomeSource[] = [
    { key: 'withdrawals', amount: input.portfolioAfterGifts * (input.withdrawalRatePct / 100) },
    { key: 'cpp', amount: input.annualCpp * inflate },
    { key: 'oas', amount: input.annualOas * inflate },
    { key: 'pension', amount: input.annualPension * inflate },
  ]
  return sources.filter(s => s.amount > 0)
}

// The goal in both spending modes: what the plan itself spends in its first
// retirement year, in today's dollars. Simple mode gives the replacement target
// (pre-tax income); detailed mode gives the budget with property costs and any
// debt still being repaid (after-tax money).
export function retirementSpendingTarget(c: CompiledPlan, result: SimResult): number {
  const row = result.rows[c.drawdownStartOffset]
  return row ? row.spending / row.cpi : 0
}

export interface MoneyLasts {
  // True when savings last until the end of the plan.
  wholePlan: boolean
  year: number
  // Age of the youngest person in that year.
  age: number
}

export function moneyLasts(plan: PlanV2, c: CompiledPlan, result: SimResult): MoneyLasts {
  const youngest = youngestPerson(plan.people) ?? plan.people[0]
  if (result.depletionOffset === null) {
    const year = c.startYear + c.years - 1
    return { wholePlan: true, year, age: year - youngest.birthYear }
  }
  const year = c.startYear + result.depletionOffset
  return { wholePlan: false, year, age: year - youngest.birthYear }
}
