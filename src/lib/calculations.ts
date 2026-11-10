import { TAX_2026 } from '@/lib/tax/data/2026'
import type { ProvinceCode } from '@/lib/plan/schema'
import type { ProjectionDataPoint } from '@/types/household'

export function getPortfolioAtRetirement(data: ProjectionDataPoint[]): number {
  return data.length > 0 ? data[data.length - 1].Total : 0
}

export interface PlannedGiftLite {
  amount: number
  age: number
}

// Gifts dated before the household retires have already left the savings by
// then, so only later ones are reserved out of the retirement portfolio.
export function giftsAfterRetirement<T extends PlannedGiftLite>(gifts: T[], retirementAge: number): T[] {
  return gifts.filter(g => g.age >= retirementAge)
}

// Total value of planned one-time gifts, expressed in the same dollar basis as the
// retirement portfolio: real ("today's") dollars when showRealValues, otherwise
// inflated to retirement age by the household's years to retirement.
export function getGiftTotal(
  gifts: PlannedGiftLite[],
  yearsToRetirement: number,
  showRealValues: boolean,
  inflationRate: number,
): number {
  if (showRealValues) {
    return gifts.reduce((sum, g) => sum + g.amount, 0)
  }
  const factor = Math.pow(1 + inflationRate / 100, Math.max(0, yearsToRetirement))
  return gifts.reduce((sum, g) => sum + g.amount * factor, 0)
}

export function getPortfolioAfterGifts(
  portfolioAtRetirement: number,
  gifts: PlannedGiftLite[],
  yearsToRetirement: number,
  showRealValues: boolean,
  inflationRate: number,
): number {
  return Math.max(0, portfolioAtRetirement - getGiftTotal(gifts, yearsToRetirement, showRealValues, inflationRate))
}

export const CPP_BASELINE_AGE = 65
export const CPP_MIN_START_AGE = 60
export const CPP_MAX_START_AGE = 70
export const QPP_MAX_START_AGE = 72

// The QPP can be deferred to 72; the CPP stops growing at 70.
export function maxPensionStartAge(province: ProvinceCode | undefined): number {
  return province === 'QC' ? QPP_MAX_START_AGE : CPP_MAX_START_AGE
}

export function clampCppStartAge(startAge: number, maxStartAge = CPP_MAX_START_AGE): number {
  return Math.min(maxStartAge, Math.max(CPP_MIN_START_AGE, Math.round(startAge)))
}

// Standard adjustments: -0.6% per month before 65, +0.7% per month after 65.
// The QPP's early reduction is 0.5-0.6% depending on the pension, so 0.6% is
// the conservative value. The entered amount is the age-65 baseline.
// The QPP early reduction runs from 0.5% to 0.6% a month with the size of the
// pension, against the base-plan maximum (R-9 s. 120.1, $1,441.25 a month in
// 2026); the CPP is a flat 0.6%. `maxStartAge` of 72 identifies the QPP, as
// elsewhere. The pension entered includes the additional plan, which slightly
// overstates the ratio and so the reduction.
const QPP_MAX_BASE_ANNUAL_2026 = 1441.25 * 12

export function cppAdjustmentFactor(startAge: number, maxStartAge = CPP_MAX_START_AGE, annualAt65?: number): number {
  const age = clampCppStartAge(startAge, maxStartAge)
  if (age < CPP_BASELINE_AGE) {
    const perMonth = maxStartAge === QPP_MAX_START_AGE && annualAt65 !== undefined
      ? 0.005 + 0.001 * Math.min(1, Math.max(0, annualAt65) / QPP_MAX_BASE_ANNUAL_2026)
      : 0.006
    return 1 - perMonth * 12 * (CPP_BASELINE_AGE - age)
  }
  if (age > CPP_BASELINE_AGE) {
    return 1 + 0.007 * 12 * (age - CPP_BASELINE_AGE)
  }
  return 1
}

// CPP only counts as retirement income once the person reaches their chosen start age.
export function getCppIncomeAtAge(
  annualCppAt65: number | undefined,
  startAge: number | undefined,
  age: number,
  maxStartAge = CPP_MAX_START_AGE,
): number {
  const resolvedStartAge = clampCppStartAge(startAge ?? CPP_BASELINE_AGE, maxStartAge)
  if (age < resolvedStartAge) return 0
  return (annualCppAt65 || 0) * cppAdjustmentFactor(resolvedStartAge, maxStartAge, annualCppAt65 || 0)
}

export const OAS_BASELINE_AGE = 65
export const OAS_MIN_START_AGE = 65
export const OAS_MAX_START_AGE = 70

export function clampOasStartAge(startAge: number): number {
  return Math.min(OAS_MAX_START_AGE, Math.max(OAS_MIN_START_AGE, Math.round(startAge)))
}

// OAS can be deferred past 65 for a permanent +0.6% per month (+7.2%/year),
// up to age 70. The entered amount is treated as the age-65 baseline.
export function oasAdjustmentFactor(startAge: number): number {
  const age = clampOasStartAge(startAge)
  return 1 + 0.006 * 12 * (age - OAS_BASELINE_AGE)
}

// OAS only counts as retirement income once the person reaches their chosen start age.
export function getOasIncomeAtAge(
  annualOasAt65: number | undefined,
  startAge: number | undefined,
  age: number,
): number {
  const resolvedStartAge = clampOasStartAge(startAge ?? OAS_BASELINE_AGE)
  if (age < resolvedStartAge) return 0
  return (annualOasAt65 || 0) * oasAdjustmentFactor(resolvedStartAge)
}

export const RETIREMENT_END_AGE = 95

export interface GuaranteedIncomePerson {
  currentAge: number
  annualPension?: number
  annualCpp?: number
  cppStartAge?: number
  oasStartAge?: number
}

// Build a year-by-year guaranteed-income stream from the household retirement
// age to the end of the plan. Each person's CPP/OAS starts at their own age, so
// delayed benefits are captured instead of being valued only at retirement.
export function buildGuaranteedIncomeSchedule(params: {
  people: GuaranteedIncomePerson[]
  householdRetirementAge: number
  yearsToRetirement: number
  endAge?: number
  oasAnnualAt65?: number
}): number[] {
  const {
    people,
    householdRetirementAge,
    yearsToRetirement,
    endAge = RETIREMENT_END_AGE,
    oasAnnualAt65 = TAX_2026.oas.maxAt65,
  } = params

  if (people.length === 0 || endAge < householdRetirementAge) return []

  const schedule: number[] = []
  for (let age = householdRetirementAge; age <= endAge; age++) {
    const offset = age - householdRetirementAge
    const guaranteed = people.reduce((sum, person) => {
      const personAge = person.currentAge + yearsToRetirement + offset
      return sum +
        (person.annualPension || 0) +
        getCppIncomeAtAge(person.annualCpp, person.cppStartAge, personAge) +
        getOasIncomeAtAge(oasAnnualAt65, person.oasStartAge, personAge)
    }, 0)
    schedule.push(guaranteed)
  }
  return schedule
}

// Convert a variable guaranteed-income stream into the constant annual amount
// with the same present value. Using the withdrawal rate as the discount rate
// keeps the existing "gap / withdrawal rate" goal formula comparable.
export function levelizeGuaranteedIncome(schedule: number[], withdrawalRate: number): number {
  if (schedule.length === 0) return 0
  if (withdrawalRate <= 0) {
    return schedule.reduce((sum, value) => sum + value, 0) / schedule.length
  }

  const rate = withdrawalRate / 100
  let presentValue = 0
  let annuityFactor = 0
  for (let year = 0; year < schedule.length; year++) {
    const discount = Math.pow(1 + rate, year)
    presentValue += schedule[year] / discount
    annuityFactor += 1 / discount
  }
  return annuityFactor > 0 ? presentValue / annuityFactor : 0
}

// What money arriving after retirement is worth at retirement. Discounting at
// the withdrawal rate keeps it comparable with levelizeGuaranteedIncome and the
// "gap / withdrawal rate" goal formula.
export function valueAtRetirement(schedule: number[], withdrawalRate: number): number {
  const rate = Math.max(0, withdrawalRate) / 100
  return schedule.reduce((sum, amount, year) => sum + amount / Math.pow(1 + rate, year), 0)
}

export interface RetirementGoalResult {
  portfolioAtRetirement: number
  // Property sold from retirement onwards, valued at retirement. Kept apart from
  // portfolioAtRetirement, which is only the savings actually there by then.
  propertySaleValue: number
  requiredAnnualIncome: number
  requiredAnnualIncomeAfterPension: number
  requiredPortfolio: number
  levelizedGuaranteedIncome: number
  giftTotal: number
  portfolioAfterGifts: number
  progress: number
  gap: number
  additionalAnnualSavings: number
  afterTaxPortfolioAtRetirement: number
  afterTaxPortfolioAfterGifts: number
  afterTaxProgress: number
  afterTaxGap: number
  afterTaxAdditionalAnnualSavings: number
}

export function calculateRetirementGoal(params: {
  currentProjectionData: ProjectionDataPoint[]
  // What the plan spends in its first retirement year, in today's dollars.
  annualSpendingTarget: number
  annualPension: number
  guaranteedIncomeSchedule?: number[]
  // Today's dollars, by year from the retirement year.
  propertySaleSchedule?: number[]
  // Today's dollars: one-time costs (discounted to retirement) and debt owed
  // then, held back from the income the savings can support.
  reserveAtRetirement?: number
  // Today's dollars to retirement-year dollars. Defaults to whole years of
  // inflation; the simulation's own index accounts for a partial first year.
  priceIndexAtRetirement?: number
  withdrawalRate: number
  yearsToRetirement: number
  expectedReturn: number
  inflationRate: number
  showRealValues?: boolean
  plannedGifts?: PlannedGiftLite[]
  effectiveTaxRate?: number
}): RetirementGoalResult {
  const {
    currentProjectionData,
    annualSpendingTarget,
    annualPension,
    guaranteedIncomeSchedule = [],
    propertySaleSchedule = [],
    withdrawalRate,
    yearsToRetirement,
    expectedReturn,
    inflationRate,
    showRealValues = true,
    plannedGifts = [],
    reserveAtRetirement = 0,
    priceIndexAtRetirement,
    effectiveTaxRate = 0,
  } = params

  // In nominal ("future dollars") mode, the income target and pension are inflated
  // to retirement-age dollars so progress stays comparable to the nominal portfolio.
  const inflationFactor = showRealValues
    ? 1
    : priceIndexAtRetirement ?? Math.pow(1 + inflationRate / 100, Math.max(0, yearsToRetirement))

  const portfolioAtRetirement = getPortfolioAtRetirement(currentProjectionData)
  const propertySaleValue = valueAtRetirement(propertySaleSchedule, withdrawalRate) * inflationFactor
  const fundsForRetirement = portfolioAtRetirement + propertySaleValue
  // Gifts are reserved as a separate pot withdrawn from the retirement portfolio.
  const reserve = reserveAtRetirement * inflationFactor
  const giftTotal = getGiftTotal(plannedGifts, 0, true, inflationRate) * inflationFactor + reserve
  const portfolioAfterGifts = Math.max(0, fundsForRetirement - giftTotal)
  // A delayed CPP/OAS start means the retirement-year benefit can be zero even
  // though the household will receive it later. Levelizing the full stream
  // values those future benefits without changing the existing goal formula.
  const levelizedGuaranteedIncome = guaranteedIncomeSchedule.length > 0
    ? levelizeGuaranteedIncome(guaranteedIncomeSchedule, withdrawalRate)
    : annualPension
  const targetPension = levelizedGuaranteedIncome * inflationFactor
  const requiredAnnualIncome = annualSpendingTarget * inflationFactor
  const requiredAnnualIncomeAfterPension = Math.max(0, requiredAnnualIncome - targetPension)
  // Required portfolio = income portfolio (for the 4% rule) PLUS the reserved gifts.
  const requiredPortfolio = (withdrawalRate > 0 ? requiredAnnualIncomeAfterPension / (withdrawalRate / 100) : 0) + giftTotal
  // With a goal that guaranteed income fully covers, no savings are needed.
  const noSavingsNeededProgress = requiredAnnualIncome > 0 ? 100 : 0
  // Not capped at 100: how far past the goal a plan is shows its margin.
  const progress = requiredPortfolio > 0 ? (fundsForRetirement / requiredPortfolio) * 100 : noSavingsNeededProgress
  const gap = requiredPortfolio - fundsForRetirement

  const additionalAnnualSavings = yearsToRetirement > 0
    ? calculateAdditionalAnnualSavings(gap / inflationFactor, yearsToRetirement, expectedReturn, inflationRate)
    : 0

  // Calculate after-tax metrics (deducting the estimated lifetime tax on the RRSP
  // portion). effectiveTaxRate is derived from the Quebec tax engine, not a flat input.
  const lastPoint = currentProjectionData.length > 0 ? currentProjectionData[currentProjectionData.length - 1] : null
  const rrspAtRetirement = lastPoint?.RRSP ?? 0
  const afterTaxPortfolioAtRetirement = fundsForRetirement - (rrspAtRetirement * (effectiveTaxRate / 100))
  const afterTaxPortfolioAfterGifts = Math.max(0, afterTaxPortfolioAtRetirement - giftTotal)
  const afterTaxProgress = requiredPortfolio > 0 ? (afterTaxPortfolioAtRetirement / requiredPortfolio) * 100 : noSavingsNeededProgress
  const afterTaxGap = requiredPortfolio - afterTaxPortfolioAtRetirement
  const afterTaxAdditionalAnnualSavings = yearsToRetirement > 0
    ? calculateAdditionalAnnualSavings(afterTaxGap / inflationFactor, yearsToRetirement, expectedReturn, inflationRate)
    : 0

  return {
    portfolioAtRetirement,
    propertySaleValue,
    requiredAnnualIncome,
    requiredAnnualIncomeAfterPension,
    requiredPortfolio,
    levelizedGuaranteedIncome,
    giftTotal,
    portfolioAfterGifts,
    progress,
    gap,
    additionalAnnualSavings,
    afterTaxPortfolioAtRetirement,
    afterTaxPortfolioAfterGifts,
    afterTaxProgress,
    afterTaxGap,
    afterTaxAdditionalAnnualSavings,
  }
}

export interface RetirementGoalWithIncome extends RetirementGoalResult {
  projectedAnnualIncome: number
  afterTaxProjectedAnnualIncome: number
}

export function calculateRetirementGoalWithIncome(
  params: Parameters<typeof calculateRetirementGoal>[0],
): RetirementGoalWithIncome {
  const goal = calculateRetirementGoal(params)
  const { withdrawalRate, yearsToRetirement, inflationRate, showRealValues = true, priceIndexAtRetirement } = params
  const inflationFactor = showRealValues ? 1 : priceIndexAtRetirement ?? Math.pow(1 + inflationRate / 100, Math.max(0, yearsToRetirement))
  const projectedGuaranteedIncome = goal.levelizedGuaranteedIncome * inflationFactor
  return {
    ...goal,
    projectedAnnualIncome: goal.portfolioAfterGifts * (withdrawalRate / 100) + projectedGuaranteedIncome,
    afterTaxProjectedAnnualIncome: goal.afterTaxPortfolioAfterGifts * (withdrawalRate / 100) + projectedGuaranteedIncome,
  }
}

// Yearly saving, in today's dollars, that closes a gap in today's dollars. An
// indicative figure. Saving rises with inflation, so the money earns the real
// return: an effective monthly rate, which also works when it is zero or
// negative (a negative rate means each dollar saved loses value).
function calculateAdditionalAnnualSavings(
  gap: number,
  yearsToRetirement: number,
  expectedReturn: number,
  inflationRate: number,
): number {
  if (gap <= 0 || yearsToRetirement <= 0) return 0
  const months = yearsToRetirement * 12
  const monthlyRealRate = Math.pow((1 + expectedReturn / 100) / (1 + inflationRate / 100), 1 / 12) - 1
  if (Math.abs(monthlyRealRate) < 1e-9) return Math.round(gap / yearsToRetirement)
  return Math.round((gap * monthlyRealRate / ((1 + monthlyRealRate) ** months - 1)) * 12)
}
