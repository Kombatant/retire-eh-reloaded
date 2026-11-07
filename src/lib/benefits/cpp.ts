import { cppAdjustmentFactor } from '@/lib/calculations'
import { getTaxYear, type TaxYearData } from '@/lib/tax/data/2026'

export { cppAdjustmentFactor }

// The 5-year average YMPE used in the benefit formula, relative to the
// current YMPE (2022–2026 average ÷ 2026 YMPE).
const YMPE_AVERAGE_FACTOR = 0.927
// 47 contributory years (18 to 65) less the 17% general drop-out.
const FULL_BASE_YEARS = 39
// The enhancement accrues over 40 years of contributions after 2019.
const FULL_ENHANCEMENT_YEARS = 40
const ENHANCEMENT_START_YEAR = 2019
const BASE_REPLACEMENT = 0.25
const ENHANCED_REPLACEMENT = 1 / 3

export interface CppEarningsProfile {
  // Average pensionable earnings as % of the YMPE (capped at 100).
  averageEarningsRatioPct: number
  // Years with CPP/QPP earnings between 18 and 65.
  contributoryYears: number
  birthYear: number
  retirementAge: number
}

// Estimated age-65 CPP/QPP retirement pension in plan-start dollars.
// Base: 25% of average YMPE scaled by earnings and the share of a full career.
// Enhancement: the extra 8.33% accrues only for years worked from 2019.
// This is an estimate; a Service Canada statement is more accurate.
export function estimateCppAt65(profile: CppEarningsProfile, data: TaxYearData = getTaxYear()): number {
  const ratio = Math.min(1, Math.max(0, profile.averageEarningsRatioPct / 100))
  const averageYmpe = data.payroll.ympe * YMPE_AVERAGE_FACTOR
  const base = BASE_REPLACEMENT * averageYmpe * ratio * Math.min(1, profile.contributoryYears / FULL_BASE_YEARS)

  const workStart = Math.max(ENHANCEMENT_START_YEAR, profile.birthYear + 18)
  const workEnd = profile.birthYear + Math.min(65, profile.retirementAge)
  const enhancedYears = Math.max(0, Math.min(workEnd - workStart, profile.contributoryYears))
  const enhancement = (ENHANCED_REPLACEMENT - BASE_REPLACEMENT) * averageYmpe * ratio *
    Math.min(1, enhancedYears / FULL_ENHANCEMENT_YEARS)

  return base + enhancement
}

export interface CppWorkHistory {
  birthYear: number
  retirementAge: number
  startedWorkingYear: number
  typicalEarnings: number // today's dollars
  yearsNotWorking: number
  childRearingYears: number
}

export interface CppEstimate {
  amountAt65: number
  // Years with CPP earnings between 18 and the earlier of retirement and 65.
  workingYears: number
  // Best years that count after the general drop-out (39 for a full period).
  countedYears: number
  // Earnings as a share of the YMPE (capped at 1).
  earningsRatio: number
  base: number
  firstEnhancement: number
  secondEnhancement: number
}

const SECOND_ENHANCEMENT_START_YEAR = 2024
const GENERAL_DROPOUT = 0.17
const FULL_PERIOD_YEARS = 47 // age 18 to 65

// Estimate the age-65 CPP/QPP pension (plan-start dollars) from a simple
// work history, following the benefit formula:
// - Contributory period: 18 to 65, less child-rearing years; the lowest 17%
//   of the remaining years are dropped, so a full career counts 39 years.
// - Base: 25% of average earnings up to the YMPE.
// - First enhancement: 8.33% more of earnings up to the YMPE, accruing over
//   40 years of work from 2019.
// - Second enhancement: 33.33% of earnings between the YMPE and YAMPE,
//   accruing over 40 years of work from 2024.
// Earnings are assumed to keep pace with the YMPE (wage growth), so a single
// "typical earnings in today's dollars" stands for the whole career.
export function estimateCppFromHistory(h: CppWorkHistory, data: TaxYearData = getTaxYear()): CppEstimate {
  const p = data.payroll
  const workStart = Math.max(h.startedWorkingYear, h.birthYear + 18)
  const workEnd = h.birthYear + Math.min(h.retirementAge, 65)
  const span = Math.max(0, workEnd - workStart)
  const gaps = Math.min(span, h.yearsNotWorking + h.childRearingYears)
  const workingYears = span - gaps
  // Share of the working span actually worked, used to thin out the
  // enhancement years as well.
  const workedShare = span > 0 ? workingYears / span : 0

  const period = Math.max(1, FULL_PERIOD_YEARS - Math.min(h.childRearingYears, FULL_PERIOD_YEARS - 1))
  const countedYears = period - Math.round(period * GENERAL_DROPOUT)
  const earnings = Math.max(0, h.typicalEarnings)
  const earningsRatio = Math.min(1, earnings / p.ympe)
  const averageYmpe = p.ympe * YMPE_AVERAGE_FACTOR

  const base = BASE_REPLACEMENT * averageYmpe * earningsRatio * Math.min(1, workingYears / countedYears)

  const yearsFrom = (year: number) => Math.max(0, workEnd - Math.max(year, workStart)) * workedShare
  const firstEnhancement = (ENHANCED_REPLACEMENT - BASE_REPLACEMENT) * averageYmpe * earningsRatio *
    Math.min(1, yearsFrom(ENHANCEMENT_START_YEAR) / FULL_ENHANCEMENT_YEARS)

  const upperRatio = Math.min(1, Math.max(0, (earnings - p.ympe) / (p.yampe - p.ympe)))
  const secondEnhancement = ENHANCED_REPLACEMENT * (p.yampe - p.ympe) * YMPE_AVERAGE_FACTOR * upperRatio *
    Math.min(1, yearsFrom(SECOND_ENHANCEMENT_START_YEAR) / FULL_ENHANCEMENT_YEARS)

  return {
    amountAt65: base + firstEnhancement + secondEnhancement,
    workingYears,
    countedYears,
    earningsRatio,
    base,
    firstEnhancement,
    secondEnhancement,
  }
}

// CPP survivor's pension for a surviving spouse, in the same dollars as the
// inputs. At 65+, 60% of the deceased's pension, with the combined pension
// capped at the maximum retirement pension. Under 65 the benefit is lower
// (37.5% plus a flat-rate portion); we use 37.5% only, which is conservative.
export function cppSurvivorBenefit(params: {
  deceasedPension: number
  survivorOwnPension: number
  survivorAge: number
  maxRetirementPension: number
}): number {
  const { deceasedPension, survivorOwnPension, survivorAge, maxRetirementPension } = params
  const rate = survivorAge >= 65 ? 0.6 : 0.375
  const benefit = Math.max(0, deceasedPension) * rate
  return Math.max(0, Math.min(benefit, maxRetirementPension - Math.max(0, survivorOwnPension)))
}
