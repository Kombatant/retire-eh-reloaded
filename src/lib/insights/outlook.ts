import { calculateRetirementGoalWithIncome, giftsAfterRetirement, type RetirementGoalResult, type RetirementGoalWithIncome } from '@/lib/calculations'
import { buildRetirementTaxSnapshot, type RetirementTaxSnapshot } from '@/lib/sim/taxSnapshot'
import { householdBaseAge, toProjectionData } from '@/lib/sim/legacyAdapter'
import { runSucceeded } from '@/lib/sim/risk'
import { toLegacyAssumptions } from '@/lib/plan/legacy-view'
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
  // Roughly how much more the plan could spend each year and still meet the
  // goal; null when it isn't on track. Measured in income, not savings, because
  // guaranteed income means progress past 100% overstates spending room.
  annualRoom: number | null
  // Guaranteed income alone covers the goal, so progressPct has nothing to measure.
  noSavingsNeeded: boolean
  // The goal is met by the savings rule, but the simulation itself runs short.
  metOnPaperOnly: boolean
}

export function retirementOutlook(
  goal: RetirementGoalResult & { projectedAnnualIncome: number; afterTaxProjectedAnnualIncome: number },
  // `planFunded` is false when the simulation itself ran short: reaching the
  // goal on paper can't be called on track if the money doesn't arrive.
  opts: { effectiveTaxRate?: number; afterTaxAnnualIncome?: number; taxSummary?: RetirementTaxSnapshot | null; planFunded?: boolean },
): RetirementOutlook {
  const taxAware = opts.effectiveTaxRate !== undefined && opts.effectiveTaxRate > 0
  const onTrack = goal.progress >= 100 && (taxAware ? goal.afterTaxProgress >= 100 : true) && opts.planFunded !== false
  const tax = opts.taxSummary

  // The goal values delayed CPP/OAS by levelizing the benefit stream. Keep the
  // after-tax figure on the same basis by applying the average tax rate to the
  // difference between levelized and retirement-year income.
  const afterTaxIncome = tax
    ? Math.max(0, tax.afterTaxIncome + (goal.projectedAnnualIncome - tax.preTaxIncome) * (1 - tax.averageTaxRate / 100))
    : (opts.afterTaxAnnualIncome ?? goal.afterTaxProjectedAnnualIncome)

  const progressPct = taxAware ? Math.min(goal.progress, goal.afterTaxProgress) : goal.progress
  // The same weaker-of-both basis as progressPct, so the two can't disagree.
  const comparableIncome = taxAware
    ? Math.min(goal.projectedAnnualIncome, goal.afterTaxProjectedAnnualIncome)
    : goal.projectedAnnualIncome

  return {
    onTrack,
    progressPct,
    progressBasis: taxAware && goal.afterTaxProgress < goal.progress ? 'afterTax' : 'preTax',
    annualRoom: onTrack ? Math.max(0, comparableIncome - goal.requiredAnnualIncome) : null,
    noSavingsNeeded: goal.requiredPortfolio <= 0 && goal.requiredAnnualIncome > 0,
    metOnPaperOnly: progressPct >= 100 && opts.planFunded === false,
    preTaxIncome: goal.projectedAnnualIncome,
    afterTaxIncome,
    estimatedTax: tax ? Math.max(0, goal.projectedAnnualIncome - afterTaxIncome) : null,
    extraSavingsNeeded: onTrack ? 0 : Math.max(goal.additionalAnnualSavings, taxAware ? goal.afterTaxAdditionalAnnualSavings : 0),
  }
}

// The goal and "on track" verdict for a simulated plan. Used by the live
// views through usePlanOutlook and by the proposals worker, which has no React
// context, so both always reach the same verdict.
export function planGoalOutlook(
  plan: PlanV2,
  c: CompiledPlan,
  result: SimResult,
  nowYear: number,
  showRealValues = true,
): { goal: RetirementGoalWithIncome; outlook: RetirementOutlook } {
  const D = c.drawdownStartOffset
  const assumptions = toLegacyAssumptions(plan, { showRealValues }, nowYear)
  const row = result.rows[D]
  const tax = buildRetirementTaxSnapshot(c, result, showRealValues)
  const goal = calculateRetirementGoalWithIncome({
    currentProjectionData: toProjectionData(c, result, showRealValues),
    annualSpendingTarget: retirementSpendingTarget(c, result),
    annualPension: row ? row.people.reduce((s, p) => s + p.pension + p.cpp + p.oas, 0) / row.cpi : 0,
    guaranteedIncomeSchedule: result.rows.slice(D).map(r => r.guaranteedIncome / r.cpi),
    withdrawalRate: assumptions.withdrawalRate,
    yearsToRetirement: D,
    expectedReturn: assumptions.expectedReturn,
    inflationRate: assumptions.inflationRate,
    currentAnnualContributions: plan.accounts.reduce((s, a) => s + (a.contributions[0]?.amount ?? 0), 0),
    currentPortfolio: plan.accounts.reduce((s, a) => s + (a.balance || 0), 0),
    showRealValues,
    plannedGifts: giftsAfterRetirement(assumptions.plannedGifts, householdBaseAge(c) + D),
    effectiveTaxRate: tax?.effectiveRrspTaxRate,
  })
  const outlook = retirementOutlook(goal, {
    effectiveTaxRate: tax?.effectiveRrspTaxRate,
    afterTaxAnnualIncome: tax?.afterTaxIncome,
    taxSummary: tax,
    planFunded: runSucceeded(result),
  })
  return { goal, outlook }
}

export type IncomeSourceKey = 'withdrawals' | 'cpp' | 'oas' | 'gis' | 'pension'

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
  annualGis?: number
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
    { key: 'gis', amount: (input.annualGis ?? 0) * inflate },
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
