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
