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
// - Not modelled: BC's Budget 2026 proposal to pause indexation for 2027-2030.
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
  // Some provinces freeze thresholds or credits instead of following CPI.
  bracketsIndexed: boolean
  creditsIndexed: boolean
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
  }
  ontario: {
    surtax: { threshold1: number; rate1: number; threshold2: number; rate2: number }
    taxReductionBasic: number
    // Ontario Health Premium bands: [incomeFrom, base, rate, cap]
    healthPremium: [number, number, number, number][]
  }
  britishColumbia: { reductionMax: number; reductionThreshold: number; reductionRate: number }
  manitoba: { bpaPhaseOutStart: number; bpaPhaseOutEnd: number }
  oas: { maxAt65: number; clawbackThreshold: number; recoveryRate: number; age75Increase: number; fullResidencyYears: number; minResidencyYears: number }
  gis: {
    single: { maxAnnual: number; incomeCutoff: number }
    coupleBothOas: { maxAnnualEach: number; combinedCutoff: number }
    coupleSpouseNoOas: { maxAnnual: number; combinedCutoff: number }
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

function province(p: Omit<ProvinceTaxData, 'ageReductionRate' | 'bracketsIndexed' | 'creditsIndexed'> & Partial<ProvinceTaxData>): ProvinceTaxData {
  return { ageReductionRate: 0.15, bracketsIndexed: true, creditsIndexed: true, ...p }
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
      creditRatePct: 8.7, basicPersonal: 11188, ageAmount: 7142, ageThreshold: 39138, pensionAmount: 1000,
      eligibleDividendCreditPct: 6.3,
    }),
    PE: province({
      name: 'Prince Edward Island',
      brackets: b([[33928, 9.5], [65820, 13.47], [106890, 16.6], [142250, 17.62], [200000, 19], [INF, 20]]),
      creditRatePct: 9.5, basicPersonal: 15000, ageAmount: 6510, ageThreshold: 36600, pensionAmount: 1000,
      eligibleDividendCreditPct: 10.5,
      // PEI does not index its personal income tax system.
      bracketsIndexed: false, creditsIndexed: false,
    }),
    NS: province({
      name: 'Nova Scotia',
      brackets: b([[30995, 8.79], [61991, 14.95], [97417, 16.67], [157124, 17.5], [INF, 21]]),
      creditRatePct: 8.79, basicPersonal: 11932, ageAmount: 5826, ageThreshold: 30828, pensionAmount: 1173,
      eligibleDividendCreditPct: 8.85,
    }),
    NB: province({
      name: 'New Brunswick',
      brackets: b([[52333, 9.4], [104666, 14], [193861, 16], [INF, 19.5]]),
      creditRatePct: 9.4, basicPersonal: 13664, ageAmount: 6158, ageThreshold: 45844, pensionAmount: 1000,
      eligibleDividendCreditPct: 14,
    }),
    QC: province({
      name: 'Quebec',
      brackets: b([[54345, 14], [108680, 19], [132245, 24], [INF, 25.75]]),
      creditRatePct: 14, basicPersonal: 18952, ageAmount: 3986, ageThreshold: 42955, pensionAmount: 0,
      ageReductionRate: 0.1875, eligibleDividendCreditPct: 11.7,
    }),
    ON: province({
      name: 'Ontario',
      // The $150,000 and $220,000 thresholds are set in law and are not indexed.
      brackets: [...b([[53891, 5.05], [107785, 9.15]]), { upTo: 150000, rate: 11.16, frozen: true }, { upTo: 220000, rate: 12.16, frozen: true }, { upTo: INF, rate: 13.16 }],
      creditRatePct: 5.05, basicPersonal: 12989, ageAmount: 6342, ageThreshold: 47210, pensionAmount: 1796,
      eligibleDividendCreditPct: 10,
    }),
    MB: province({
      name: 'Manitoba',
      brackets: b([[47000, 10.8], [100000, 12.75], [INF, 17.4]]),
      creditRatePct: 10.8, basicPersonal: 15780, ageAmount: 3728, ageThreshold: 27749, pensionAmount: 1000,
      eligibleDividendCreditPct: 8,
      // Manitoba stopped indexing its thresholds and basic personal amount from 2025.
      bracketsIndexed: false, creditsIndexed: false,
    }),
    SK: province({
      name: 'Saskatchewan',
      brackets: b([[54532, 10.5], [155805, 12.5], [INF, 14.5]]),
      creditRatePct: 10.5, basicPersonal: 20381, ageAmount: 5901, ageThreshold: 43927, pensionAmount: 1000,
      eligibleDividendCreditPct: 11,
    }),
    AB: province({
      name: 'Alberta',
      brackets: b([[61200, 8], [154259, 10], [185111, 12], [246813, 13], [370220, 14], [INF, 15]]),
      creditRatePct: 8, basicPersonal: 22769, ageAmount: 6345, ageThreshold: 47234, pensionAmount: 1753,
      eligibleDividendCreditPct: 8.12,
    }),
    BC: province({
      name: 'British Columbia',
      brackets: b([[50363, 5.6], [100728, 7.7], [115648, 10.5], [140430, 12.29], [190405, 14.7], [265545, 16.8], [INF, 20.5]]),
      creditRatePct: 5.6, basicPersonal: 13216, ageAmount: 5927, ageThreshold: 44119, pensionAmount: 1000,
      eligibleDividendCreditPct: 12,
    }),
    YT: province({
      name: 'Yukon',
      brackets: b([[58523, 6.4], [117045, 9], [181440, 10.9], [500000, 12.8], [INF, 15]]),
      // Yukon's basic personal amount follows the federal amount and phase-out.
      creditRatePct: 6.4, basicPersonal: 16452, ageAmount: 9208, ageThreshold: 46432, pensionAmount: 2000,
      eligibleDividendCreditPct: 12.02,
    }),
    NT: province({
      name: 'Northwest Territories',
      brackets: b([[53003, 5.9], [106009, 8.6], [172346, 12.2], [INF, 14.05]]),
      creditRatePct: 5.9, basicPersonal: 18198, ageAmount: 8902, ageThreshold: 46432, pensionAmount: 1000,
      eligibleDividendCreditPct: 11.5,
    }),
    NU: province({
      name: 'Nunavut',
      brackets: b([[55801, 4], [111602, 7], [181439, 9], [INF, 11.5]]),
      creditRatePct: 4, basicPersonal: 19659, ageAmount: 12550, ageThreshold: 46432, pensionAmount: 2000,
      eligibleDividendCreditPct: 5.51,
    }),
  },
  quebec: {
    retirementIncomeAmount: 3541,
    creditReductionThreshold: 42955,
    creditReductionRate: 0.1875,
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
  britishColumbia: { reductionMax: 575, reductionThreshold: 25570, reductionRate: 0.0356 },
  manitoba: { bpaPhaseOutStart: 200000, bpaPhaseOutEnd: 400000 },
  oas: {
    maxAt65: 9024,
    clawbackThreshold: 95323,
    recoveryRate: 0.15,
    age75Increase: 0.1,
    fullResidencyYears: 40,
    minResidencyYears: 10,
  },
  gis: {
    single: { maxAnnual: 1138.9 * 12, incomeCutoff: 23112 },
    coupleBothOas: { maxAnnualEach: 685.56 * 12, combinedCutoff: 30528 },
    coupleSpouseNoOas: { maxAnnual: 1138.9 * 12, combinedCutoff: 55392 },
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
