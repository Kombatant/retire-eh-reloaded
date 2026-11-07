// Original Quebec estimator (v1). Kept for the v1-compat engine path and its tests.
export {
  FEDERAL_BRACKETS_2026,
  QUEBEC_BRACKETS_2026,
  FEDERAL_BPA_2026,
  FEDERAL_AGE_AMOUNT_2026,
  FEDERAL_AGE_AMOUNT_THRESHOLD_2026,
  FEDERAL_PENSION_AMOUNT_2026,
  QUEBEC_BPA_2026,
  QUEBEC_AGE_AMOUNT_2026,
  QUEBEC_RETIREMENT_AMOUNT_2026,
  QUEBEC_CREDIT_REDUCTION_THRESHOLD_2026,
  QUEBEC_CREDIT_REDUCTION_RATE,
  OAS_MAX_ANNUAL_2026,
  OAS_CLAWBACK_THRESHOLD_2026,
  OAS_RECOVERY_RATE,
  progressiveTax,
  marginalRate,
  combinedMarginalRate,
  computePersonTax,
  computeRetirementTaxSummary,
  type PersonTaxInput,
  type PersonTaxResult,
  type RetirementIncomePerson,
  type PersonRetirementTax,
  type RetirementTaxSummary,
} from './quebecLegacy'

// All-province engine.
export { TAX_2026, getTaxYear, type TaxYearData, type ProvinceTaxData } from './data/2026'
export { phaseOut } from './core'
export { payrollContributions, type PayrollContributions } from './payroll'
export {
  computeIncomeTax,
  marginalTaxRate,
  emptyIncome,
  eligiblePensionIncome,
  ontarioHealthPremium,
  CAPITAL_GAINS_INCLUSION,
  type IncomeTaxInput,
  type IncomeTaxResult,
  type TaxOptions,
} from './personal'
export { computeHouseholdTax, splittableAmount, type HouseholdTaxResult } from './household'
export { provinceName, jurisdictionLabel } from './labels'
