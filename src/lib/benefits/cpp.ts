import { cppAdjustmentFactor } from '@/lib/calculations'
import { getTaxYear, type TaxYearData } from '@/lib/tax/data/2026'
import type { ProvinceCode } from '@/lib/plan/schema'

export { cppAdjustmentFactor }

// The 5-year average YMPE used in the benefit formula, relative to the
// current YMPE (2022–2026 average ÷ 2026 YMPE).
const YMPE_AVERAGE_FACTOR = 0.927
// 47 contributory years (18 to 65) less the 17% general drop-out.
const FULL_BASE_YEARS = 39
// The QPP drops 15% of the reference period, not 17%, so a full career is 40.
const QPP_FULL_BASE_YEARS = 40
const QPP_GENERAL_DROPOUT = 0.15
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
  province?: ProvinceCode
}

// Estimated age-65 CPP/QPP retirement pension in plan-start dollars.
// Base: 25% of average YMPE scaled by earnings and the share of a full career.
// Enhancement: the extra 8.33% accrues only for years worked from 2019.
// This is an estimate; a Service Canada statement is more accurate.
export function estimateCppAt65(profile: CppEarningsProfile, data: TaxYearData = getTaxYear()): number {
  const ratio = Math.min(1, Math.max(0, profile.averageEarningsRatioPct / 100))
  const averageYmpe = data.payroll.ympe * YMPE_AVERAGE_FACTOR
  const base = BASE_REPLACEMENT * averageYmpe * ratio * Math.min(1, profile.contributoryYears / (profile.province === 'QC' ? QPP_FULL_BASE_YEARS : FULL_BASE_YEARS))

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
  province?: ProvinceCode
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
  const countedYears = period - Math.round(period * (h.province === 'QC' ? QPP_GENERAL_DROPOUT : GENERAL_DROPOUT))
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

// The survivor's pension for a surviving spouse, in the same dollars as the
// inputs. `deceasedPension` is the deceased's pension at 65, because both laws
// disregard early and late starts here.
//
// CPP (Canada Pension Plan s. 58): under 65, a flat rate plus 37.5%; from 65,
// 60%. With a retirement pension of one's own the percentage part drops by 40%
// of the lesser of it and that pension (at 65), and the two together are capped.
//
// QPP (Act respecting the Québec Pension Plan, ss. 133–137): a flat amount by
// age plus 37.5% under 65, 60% from 65. With a pension of one's own (`d`, as
// paid), the base-plan maximum adjusted for the survivor's start age (`c`)
// limits it: under 65 to flat + c − d (s. 136), from 65 to the lesser of c − d
// and the greater of 37.5% and 60% − 40% of d (s. 136.1). The survivor is taken
// to have no dependent children and not to be disabled. One pension figure is
// used, so the additional plan's separate 50% isn't applied.
export function cppSurvivorBenefit(params: {
  deceasedPension: number
  survivorOwnPension: number
  survivorAge: number
  ownPensionPayable: boolean
  plan: 'cpp' | 'qpp'
  // QPP only: the survivor's own pension as paid, and the age it started.
  survivorOwnPensionPaid?: number
  survivorStartAge?: number
}, data: TaxYearData = getTaxYear()): number {
  const { deceasedPension, survivorOwnPension, survivorAge, ownPensionPayable, plan } = params
  const s = data.cppSurvivor
  const a = Math.max(0, deceasedPension)

  if (plan === 'qpp') {
    const flat = survivorAge >= 45 ? s.qppFixed45To64Annual : s.qppFixedUnder45Annual
    if (!ownPensionPayable) return survivorAge >= 65 ? 0.6 * a : 0.375 * a + flat
    const d = Math.max(0, params.survivorOwnPensionPaid ?? survivorOwnPension)
    const c = s.qppMaxBaseAnnual * cppAdjustmentFactor(params.survivorStartAge ?? 65, 72)
    const amount = survivorAge >= 65
      ? Math.min(c - d, Math.max(0.375 * a, 0.6 * a - 0.4 * d))
      : Math.min(0.375 * a + flat, flat + c - d)
    return Math.max(0, amount)
  }

  const rate = survivorAge >= 65 ? 0.6 : 0.375
  const percentage = a * rate
  const own = ownPensionPayable ? Math.max(0, survivorOwnPension) : 0
  const flat = survivorAge >= 65 ? 0 : s.flatRateAnnual
  if (!ownPensionPayable) return flat + percentage
  const reduced = percentage - Math.min(0.4 * percentage, 0.4 * own)
  return flat + Math.max(0, Math.min(reduced, s.combinedMaxAnnual - own))
}
