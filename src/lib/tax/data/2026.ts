import type { ProvinceCode } from '@/lib/plan/schema'

// 2026 tax and benefit parameters.
//
// Sources (retrieved November 2026):
// - Brackets: CRA "Tax rates and income brackets for individuals – current year"
//   (canada.ca/en/revenue-agency/services/tax/individuals/tax-rates-brackets/current-year.html).
// - Basic personal amounts, Ontario surtax/health premium/tax reduction,
//   BC tax reduction, Manitoba BPA phase-out, CPP/QPP/EI: CRA T4127 Payroll
//   Deductions Formulas, January 2026 edition.
// - Age, pension income and credit rates: TaxTips.ca 2026 non-refundable credit table.
// - Quebec: Revenu Québec 2026 (unchanged from the original estimator).
// - OAS/GIS: Canada.ca OAS payment amounts, October–December 2026.
// - Dividend tax credit rates are the published 2025 rates; review annually.
//
// See SOURCES.md for each table's source, retrieval date and status.
//
// Updating for a new year: copy this file, update every figure from the same
// sources, and add golden cases to src/test/tax-provinces.test.ts.

export interface TaxBracket {
  upTo: number
  rate: number // percent
  // This threshold is fixed in law even where the province's others are indexed.
  frozen?: boolean
}

export interface ProvinceTaxData {
  name: string
  brackets: TaxBracket[]
  // Non-refundable credits are multiplied by this rate (usually the lowest bracket rate).
  creditRatePct: number
  basicPersonal: number
  ageAmount: number
  ageThreshold: number
  ageReductionRate: number
  pensionAmount: number
  // Eligible-dividend tax credit as % of the grossed-up dividend.
  eligibleDividendCreditPct: number
  // Low-income reduction, claimed once per family against provincial tax.
  lowIncomeReduction?: { basic: number; spouse: number; age: number; threshold: number; coupleThreshold?: number; rate: number }
  // A credit for people 65 or older below an income (Nova Scotia).
  ageTaxCredit?: { amount: number; incomeBelow: number }
  // Spouse or common-law partner amount: claimed by the higher earner, reduced
  // by the partner's net income above the threshold. Quebec has none.
  spousalAmount: number
  spousalThreshold: number
  // The amount rises with the basic personal amount's scheduled steps.
  spousalFollowsBasic?: boolean
  // Some provinces freeze thresholds or credits instead of following CPI.
  bracketsIndexed: boolean
  creditsIndexed: boolean
  // Most pension credits are a fixed number of dollars; true where it follows CPI.
  pensionIndexed?: boolean
  // Years in which a normally indexed province applies no indexation.
  indexPauses?: { from: number; to: number }[]
  // Changes to the basic personal amount written into law for a given year.
  basicPersonalSteps?: { year: number; setTo?: number; add?: number }[]
}

export interface TaxYearData {
  year: number
  federal: {
    brackets: TaxBracket[]
    creditRatePct: number
    basicPersonal: { max: number; min: number; phaseOutStart: number; phaseOutEnd: number }
    ageAmount: number
    ageThreshold: number
    ageReductionRate: number
    pensionAmount: number
    canadaEmploymentAmount: number
    eligibleDividendGrossUp: number
    eligibleDividendCreditPct: number
    quebecAbatement: number
  }
  provinces: Record<ProvinceCode, ProvinceTaxData>
  quebec: {
    retirementIncomeAmount: number
    creditReductionThreshold: number
    creditReductionRate: number
    // Schedule F. The thresholds are the 2025 form's until the 2026 form is out.
    healthContribution: { lowerThreshold: number; lowerMax: number; upperThreshold: number; upperBase: number; upperMax: number; rate: number }
  }
  ontario: {
    surtax: { threshold1: number; rate1: number; threshold2: number; rate2: number }
    taxReductionBasic: number
    // Ontario Health Premium bands: [incomeFrom, base, rate, cap]
    healthPremium: [number, number, number, number][]
  }
  britishColumbia: { reductionMax: number; reductionThreshold: number; reductionRate: number }
  manitoba: { bpaPhaseOutStart: number; bpaPhaseOutEnd: number }
  cppSurvivor: { flatRateAnnual: number; combinedMaxAnnual: number; qppFixedUnder45Annual: number; qppFixed45To64Annual: number; qppMaxBaseAnnual: number }
  oas: { maxAt65: number; clawbackThreshold: number; recoveryRate: number; age75Increase: number; fullResidencyYears: number; minResidencyYears: number }
  // Monthly benefit at each income, straight-line between points, zero from the
  // last point on. Simplified from the published tables to within $3 a month.
  gis: {
    single: [number, number][]
    coupleBothOas: [number, number][]
    coupleSpouseNoOas: [number, number][]
    couplePensionerWithAllowance: [number, number][]
    coupleAllowance: [number, number][]
    survivorAllowance: [number, number][]
    allowanceMinAge: number
    allowanceMaxAge: number
    allowanceMinResidencyYears: number
    employmentExemptionFull: number
    employmentExemptionHalf: number
  }
  limits: {
    tfsaAnnual: number
    rrspRate: number
    rrspMax: number
    fhsaAnnual: number
    fhsaLifetime: number
  }
  payroll: {
    ympe: number
    yampe: number
    basicExemption: number
    cpp: { baseRate: number; firstAdditionalRate: number; secondAdditionalRate: number }
    qpp: { baseRate: number; firstAdditionalRate: number; secondAdditionalRate: number }
    ei: { maxInsurable: number; rate: number; quebecRate: number }
    qpip: { maxInsurable: number; rate: number; selfEmployedRate: number }
  }
}

const b = (pairs: [number, number][]): TaxBracket[] => pairs.map(([upTo, rate]) => ({ upTo, rate }))
const INF = Infinity

function province(p: Omit<ProvinceTaxData, 'ageReductionRate' | 'bracketsIndexed' | 'creditsIndexed' | 'spousalThreshold'> & Partial<ProvinceTaxData>): ProvinceTaxData {
  return { ageReductionRate: 0.15, bracketsIndexed: true, creditsIndexed: true, spousalThreshold: 0, ...p }
}

export const TAX_2026: TaxYearData = {
  year: 2026,
  federal: {
    brackets: b([[58523, 14], [117045, 20.5], [181440, 26], [258482, 29], [INF, 33]]),
    creditRatePct: 14,
    basicPersonal: { max: 16452, min: 14829, phaseOutStart: 181440, phaseOutEnd: 258482 },
    ageAmount: 9208,
    ageThreshold: 46432,
    ageReductionRate: 0.15,
    pensionAmount: 2000,
    canadaEmploymentAmount: 1501,
    eligibleDividendGrossUp: 0.38,
    eligibleDividendCreditPct: 15.0198,
    quebecAbatement: 0.165,
  },
  provinces: {
    NL: province({
      name: 'Newfoundland and Labrador',
      brackets: b([[44678, 8.7], [89354, 14.5], [159528, 15.8], [223340, 17.8], [285319, 19.8], [570638, 20.8], [1141275, 21.3], [INF, 21.8]]),
      // $13,094 is the 2026 blend of the old $11,188 and the new $15,000.
      creditRatePct: 8.7, basicPersonal: 13094, ageAmount: 7142, ageThreshold: 39138, pensionAmount: 1000,
      spousalAmount: 9142, spousalThreshold: 915,
      lowIncomeReduction: { basic: 997, spouse: 557, age: 0, threshold: 23928, coupleThreshold: 40460, rate: 0.16 },
      eligibleDividendCreditPct: 6.3,
      basicPersonalSteps: [{ year: 2027, setTo: 15000 }],
    }),
    PE: province({
      name: 'Prince Edward Island',
      brackets: b([[33928, 9.5], [65820, 13.47], [106890, 16.6], [142250, 17.62], [200000, 19], [INF, 20]]),
      creditRatePct: 9.5, basicPersonal: 15000, ageAmount: 6510, ageThreshold: 36600, pensionAmount: 1000,
      spousalAmount: 12740, spousalThreshold: 1274,
      lowIncomeReduction: { basic: 350, spouse: 350, age: 250, threshold: 22650, rate: 0.05 },
      eligibleDividendCreditPct: 10.5,
      // PEI does not index its personal income tax system.
      bracketsIndexed: false, creditsIndexed: false,
    }),
    NS: province({
      name: 'Nova Scotia',
      brackets: b([[30995, 8.79], [61991, 14.95], [97417, 16.67], [157124, 17.5], [INF, 21]]),
      creditRatePct: 8.79, basicPersonal: 11932, ageAmount: 5826, ageThreshold: 30828, pensionAmount: 1173,
      spousalAmount: 11932, spousalThreshold: 888,
      lowIncomeReduction: { basic: 300, spouse: 300, age: 0, threshold: 15000, rate: 0.05 },
      ageTaxCredit: { amount: 1000, incomeBelow: 24000 },
      eligibleDividendCreditPct: 8.85,
    }),
    NB: province({
      name: 'New Brunswick',
      brackets: b([[52333, 9.4], [104666, 14], [193861, 16], [INF, 19.5]]),
      creditRatePct: 9.4, basicPersonal: 13664, ageAmount: 6158, ageThreshold: 45844, pensionAmount: 1000,
      spousalAmount: 10709, spousalThreshold: 1072,
      lowIncomeReduction: { basic: 802, spouse: 802, age: 0, threshold: 21920, rate: 0.03 },
      eligibleDividendCreditPct: 14,
    }),
    QC: province({
      name: 'Quebec',
      brackets: b([[54345, 14], [108680, 19], [132245, 24], [INF, 25.75]]),
      creditRatePct: 14, basicPersonal: 18952, ageAmount: 3986, ageThreshold: 42955, pensionAmount: 0,
      spousalAmount: 0,
      ageReductionRate: 0.1875, eligibleDividendCreditPct: 11.7,
    }),
    ON: province({
      name: 'Ontario',
      // The $150,000 and $220,000 thresholds are set in law and are not indexed.
      brackets: [...b([[53891, 5.05], [107785, 9.15]]), { upTo: 150000, rate: 11.16, frozen: true }, { upTo: 220000, rate: 12.16, frozen: true }, { upTo: INF, rate: 13.16 }],
      creditRatePct: 5.05, basicPersonal: 12989, ageAmount: 6342, ageThreshold: 47210, pensionAmount: 1796,
      spousalAmount: 11029, spousalThreshold: 1103,
      eligibleDividendCreditPct: 10,
      pensionIndexed: true,
    }),
    MB: province({
      name: 'Manitoba',
      brackets: b([[47000, 10.8], [100000, 12.75], [INF, 17.4]]),
      creditRatePct: 10.8, basicPersonal: 15780, ageAmount: 3728, ageThreshold: 27749, pensionAmount: 1000,
      spousalAmount: 9134,
      eligibleDividendCreditPct: 8,
      // Manitoba stopped indexing its thresholds and basic personal amount from 2025.
      bracketsIndexed: false, creditsIndexed: false,
    }),
    SK: province({
      name: 'Saskatchewan',
      brackets: b([[54532, 10.5], [155805, 12.5], [INF, 14.5]]),
      creditRatePct: 10.5, basicPersonal: 20381, ageAmount: 5901, ageThreshold: 43927, pensionAmount: 1000,
      spousalAmount: 20381, spousalThreshold: 2038, spousalFollowsBasic: true,
      eligibleDividendCreditPct: 11,
      // The Saskatchewan Affordability Act adds $500 a year through 2028, on top of indexation.
      basicPersonalSteps: [{ year: 2027, add: 500 }, { year: 2028, add: 500 }],
    }),
    AB: province({
      name: 'Alberta',
      brackets: b([[61200, 8], [154259, 10], [185111, 12], [246813, 13], [370220, 14], [INF, 15]]),
      creditRatePct: 8, basicPersonal: 22769, ageAmount: 6345, ageThreshold: 47234, pensionAmount: 1753,
      spousalAmount: 22769,
      eligibleDividendCreditPct: 8.12,
      pensionIndexed: true,
    }),
    BC: province({
      name: 'British Columbia',
      brackets: b([[50363, 5.6], [100728, 7.7], [115648, 10.5], [140430, 12.29], [190405, 14.7], [265545, 16.8], [INF, 20.5]]),
      creditRatePct: 5.6, basicPersonal: 13216, ageAmount: 5927, ageThreshold: 44119, pensionAmount: 1000,
      spousalAmount: 11317, spousalThreshold: 1132,
      eligibleDividendCreditPct: 12,
      // Income Tax Act (BC) s. 4.52(4.25), added by Budget Measures Implementation Act, 2026.
      indexPauses: [{ from: 2027, to: 2030 }],
    }),
    YT: province({
      name: 'Yukon',
      brackets: b([[58523, 6.4], [117045, 9], [181440, 10.9], [500000, 12.8], [INF, 15]]),
      // Yukon's basic personal amount follows the federal amount and phase-out.
      creditRatePct: 6.4, basicPersonal: 16452, ageAmount: 9208, ageThreshold: 46432, pensionAmount: 2000,
      // Harmonized with the federal amount and its phase-out, handled with the basic amount.
      spousalAmount: 16452,
      eligibleDividendCreditPct: 12.02,
    }),
    NT: province({
      name: 'Northwest Territories',
      brackets: b([[53003, 5.9], [106009, 8.6], [172346, 12.2], [INF, 14.05]]),
      creditRatePct: 5.9, basicPersonal: 18198, ageAmount: 8902, ageThreshold: 46432, pensionAmount: 1000,
      spousalAmount: 18198,
      eligibleDividendCreditPct: 11.5,
    }),
    NU: province({
      name: 'Nunavut',
      brackets: b([[55801, 4], [111602, 7], [181439, 9], [INF, 11.5]]),
      creditRatePct: 4, basicPersonal: 19659, ageAmount: 12550, ageThreshold: 46432, pensionAmount: 2000,
      spousalAmount: 19659,
      eligibleDividendCreditPct: 5.51,
    }),
  },
  quebec: {
    retirementIncomeAmount: 3541,
    creditReductionThreshold: 42955,
    creditReductionRate: 0.1875,
    healthContribution: { lowerThreshold: 18130, lowerMax: 150, upperThreshold: 63060, upperBase: 150, upperMax: 1000, rate: 0.01 },
  },
  ontario: {
    surtax: { threshold1: 5818, rate1: 0.2, threshold2: 7446, rate2: 0.36 },
    taxReductionBasic: 300,
    healthPremium: [
      [20000, 0, 0.06, 300],
      [36000, 300, 0.06, 450],
      [48000, 450, 0.25, 600],
      [72000, 600, 0.25, 750],
      [200000, 750, 0.25, 900],
    ],
  },
  britishColumbia: { reductionMax: 690, reductionThreshold: 25570, reductionRate: 0.0356 },
  manitoba: { bpaPhaseOutStart: 200000, bpaPhaseOutEnd: 400000 },
  cppSurvivor: {
    flatRateAnnual: 238.17 * 12,
    combinedMaxAnnual: 1531.56 * 12,
    // QPP flat amounts (R-9 s. 133, indexed): the gaps between Retraite Québec's
    // 2026 maximums ($719.50, $1,173.58) give $156.35 under 45 and $610.43 from 45.
    qppFixedUnder45Annual: 156.35 * 12,
    qppFixed45To64Annual: 610.43 * 12,
    // Base-plan maximum pension at 65 (s. 116.6), Retraite Québec 2026.
    qppMaxBaseAnnual: 1441.25 * 12,
  },
  oas: {
    maxAt65: 9150,
    clawbackThreshold: 95323,
    recoveryRate: 0.15,
    age75Increase: 0.1,
    fullResidencyYears: 40,
    minResidencyYears: 10,
  },
  gis: {
    single: [[0, 1138.9], [2040, 1053.9], [10512, 524.49], [23112, 0]],
    coupleBothOas: [[0, 685.56], [4080, 600.56], [8832, 451.57], [30528, 0]],
    coupleSpouseNoOas: [[0, 1138.9], [4000, 1138.9], [9184, 1084.9], [21024, 715.49], [55392, 0]],
    couplePensionerWithAllowance: [[0, 685.56], [4080, 685.56], [8800, 635.57], [12240, 635.57], [30144, 262.92], [42768, 262.92]],
    coupleAllowance: [[0, 1448.06], [4096, 1192.06], [8832, 846.07], [12192, 636.07], [42768, 0]],
    survivorAllowance: [[0, 1726.18], [2048, 1599.18], [10464, 896.18], [12192, 787.77], [31152, 0]],
    allowanceMinAge: 60,
    allowanceMaxAge: 64,
    allowanceMinResidencyYears: 10,
    employmentExemptionFull: 5000,
    employmentExemptionHalf: 10000,
  },
  limits: {
    tfsaAnnual: 7000,
    rrspRate: 0.18,
    rrspMax: 33810,
    fhsaAnnual: 8000,
    fhsaLifetime: 40000,
  },
  payroll: {
    ympe: 74600,
    yampe: 85000,
    basicExemption: 3500,
    cpp: { baseRate: 0.0495, firstAdditionalRate: 0.01, secondAdditionalRate: 0.04 },
    qpp: { baseRate: 0.053, firstAdditionalRate: 0.01, secondAdditionalRate: 0.04 },
    ei: { maxInsurable: 68900, rate: 0.0163, quebecRate: 0.013 },
    qpip: { maxInsurable: 103000, rate: 0.0043, selfEmployedRate: 0.00764 },
  },
}

export function getTaxYear(): TaxYearData {
  // Only one year of data exists. The engine works in plan-start dollars, so
  // later years reuse these figures with CPI indexation (see `deflator` in
  // computeIncomeTax for jurisdictions that do not index).
  return TAX_2026
}
