import { calculateRetirementGoalWithIncome, valueAtRetirement, type RetirementGoalResult, type RetirementGoalWithIncome } from '@/lib/calculations'
import { buildRetirementTaxSnapshot, type RetirementTaxSnapshot } from '@/lib/sim/taxSnapshot'
import { toProjectionData } from '@/lib/sim/legacyAdapter'
import { evaluateFunding, type FundingResult } from '@/lib/sim/funding'
import { toLegacyAssumptions } from '@/lib/plan/legacy-view'
import type { PlanV2 } from '@/lib/plan/schema'
import type { CompiledPlan, SimResult } from '@/lib/sim/types'
import { youngestPerson } from '@/lib/plan/time'

// The headline answer to "am I on track?", shared by the Plan live rail and
// the Dashboard so both always show the same numbers.
export interface RetirementOutlook {
  // The simulation funds every year and there is a target to measure against.
  // The savings guideline below never decides this.
  onTrack: boolean
  // Simple mode with no salary and no income target entered.
  needsTarget: boolean
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
  // How much of the progress comes from selling property later, valued at retirement.
  propertySaleValue: number
}

export function retirementOutlook(
  goal: RetirementGoalResult & { projectedAnnualIncome: number; afterTaxProjectedAnnualIncome: number },
  // The verdict comes from the simulation; the rest of `goal` is a guideline.
  opts: { effectiveTaxRate?: number; afterTaxAnnualIncome?: number; taxSummary?: RetirementTaxSnapshot | null; planFunded: boolean; needsTarget?: boolean },
): RetirementOutlook {
  const taxAware = opts.effectiveTaxRate !== undefined && opts.effectiveTaxRate > 0
  const needsTarget = opts.needsTarget ?? false
  const onTrack = opts.planFunded && !needsTarget
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
    needsTarget,
    progressPct,
    progressBasis: taxAware && goal.afterTaxProgress < goal.progress ? 'afterTax' : 'preTax',
    annualRoom: onTrack && progressPct >= 100 ? Math.max(0, comparableIncome - goal.requiredAnnualIncome) : null,
    noSavingsNeeded: goal.requiredPortfolio <= 0 && goal.requiredAnnualIncome > 0,
    metOnPaperOnly: progressPct >= 100 && !opts.planFunded,
    propertySaleValue: goal.propertySaleValue,
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
): { goal: RetirementGoalWithIncome; outlook: RetirementOutlook; funding: FundingResult } {
  const D = c.drawdownStartOffset
  const assumptions = toLegacyAssumptions(plan, { showRealValues }, nowYear)
  const row = result.rows[c.headlineOffset]
  const tax = buildRetirementTaxSnapshot(c, result, showRealValues)
  const funding = evaluateFunding(c, result)
  const goal = calculateRetirementGoalWithIncome({
    currentProjectionData: toProjectionData(c, result, showRealValues),
    annualSpendingTarget: guidelineSpending(c, result),
    reserveAtRetirement: guidelineReserve(c, result, assumptions.withdrawalRate),
    priceIndexAtRetirement: result.rows[D]?.cpi,
    annualPension: row ? row.people.reduce((s, p) => s + p.pension + p.cpp + p.oas, 0) / row.cpi : 0,
    guaranteedIncomeSchedule: result.rows.slice(D).map(r => r.guaranteedIncome / r.cpi / r.periodFraction),
    propertySaleSchedule: result.rows.slice(D).map(r => r.propertySaleCredit / r.cpi),
    withdrawalRate: assumptions.withdrawalRate,
    yearsToRetirement: D,
    expectedReturn: assumptions.expectedReturn,
    inflationRate: assumptions.inflationRate,
    showRealValues,
    effectiveTaxRate: tax?.effectiveRrspTaxRate,
  })
  const outlook = retirementOutlook(goal, {
    effectiveTaxRate: tax?.effectiveRrspTaxRate,
    afterTaxAnnualIncome: tax?.afterTaxIncome,
    taxSummary: tax,
    planFunded: funding.funded,
    needsTarget: funding.needsTarget,
  })
  return { goal, outlook, funding }
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
  const row = result.rows[c.headlineOffset]
  return row ? row.spending / row.cpi : 0
}

function phaseMultiplierAt(c: CompiledPlan, t: number): number {
  let multiplier = 1
  for (const phase of [...c.phases].sort((a, b) => a.startOffset - b.startOffset)) {
    if (t >= phase.startOffset && t < phase.endOffset) multiplier = phase.multiplier
  }
  return multiplier
}

// Today's dollars of one recurring flow in year t; a cost every N years counts
// as its yearly equivalent here, even in the years it isn't paid.
function recurringReal(flow: CompiledPlan['expenses'][number]['flow'], t: number, cpi: number): number {
  if (t < flow.startOffset || t >= flow.endOffset) return 0
  const value = flow.amount * Math.pow(1 + flow.ratePct / 100, t)
  return (flow.basis === 'real' ? value : value / cpi) / flow.everyN
}

// What the savings guideline is measured against: recurring spending in the
// first retirement year. Unlike the year's actual spending it leaves out one-time
// costs and debt payments, which would otherwise be capitalized as if they lasted
// forever; `guidelineReserve` counts those once.
export function guidelineSpending(c: CompiledPlan, result: SimResult): number {
  const D = c.drawdownStartOffset
  const row = result.rows[c.headlineOffset]
  if (!row) return 0
  if (c.expenseMode === 'simple') return row.spending / row.cpi
  const flexible = phaseMultiplierAt(c, D)
  const items = c.expenses.reduce((total, e) => {
    if (e.oneTime) return total
    return total + recurringReal(e.flow, D, row.cpi) * (e.essential ? 1 : flexible)
  }, 0)
  const propertyCosts = c.properties.reduce((total, p) => (
    p.saleOffset >= 0 && p.saleOffset <= D && p.replacementValue <= 0 ? total : total + p.annualCosts
  ), 0)
  return items + propertyCosts
}

// One-time costs from retirement on, each discounted from its own date, plus
// any debt still owed when retirement starts. Today's dollars.
export function guidelineReserve(c: CompiledPlan, result: SimResult, withdrawalRatePct: number): number {
  const D = c.drawdownStartOffset
  const schedule: number[] = new Array(Math.max(0, c.years - D)).fill(0)
  for (const e of c.expenses) {
    if (!e.oneTime || e.flow.startOffset < D || e.flow.startOffset >= c.years) continue
    schedule[e.flow.startOffset - D] += e.flow.amount * Math.pow(1 + e.flow.ratePct / 100, e.flow.startOffset)
  }
  const owedRow = result.rows[D - 1]
  const debtOwed = D > 0 && owedRow ? owedRow.debtBalance / owedRow.cpiEnd : c.debts.reduce((s, d) => s + d.balance, 0)
  return valueAtRetirement(schedule, withdrawalRatePct) + debtOwed
}

export interface MoneyLasts {
  // True when every year of the plan is funded.
  wholePlan: boolean
  year: number
  // Age of the youngest person in that year.
  age: number
  // What happened: why a year fell short, or that income carries on after savings.
  note: string
}

export function moneyLasts(plan: PlanV2, c: CompiledPlan, result: SimResult): MoneyLasts {
  const youngest = youngestPerson(plan.people) ?? plan.people[0]
  const funding = evaluateFunding(c, result)
  const ageIn = (year: number) => year - youngest.birthYear
  if (funding.firstShortfall) {
    const { year } = funding.firstShortfall
    const note = funding.cause === 'limits'
      ? `Withdrawal limits fall short in ${year}`
      : funding.cause === 'strategy'
        ? `Withdrawals are set too low in ${year}`
        : `Savings run out in ${year}`
    return { wholePlan: false, year, age: ageIn(year), note }
  }
  const year = c.startYear + c.years - 1
  const note = funding.depletion
    ? `Savings run out in ${funding.depletion.year}; income covers the rest`
    : 'Savings last the whole plan'
  return { wholePlan: true, year, age: ageIn(year), note }
}
