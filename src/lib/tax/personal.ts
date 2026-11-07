import type { ProvinceCode } from '@/lib/plan/schema'
import { getTaxYear, type TaxYearData } from './data/2026'
import { phaseOut, progressiveTax } from './core'
import { payrollContributions, type PayrollContributions } from './payroll'

// Personal income tax for any province or territory, in plan-start dollars.
//
// Estimator scope: ordinary income, employment (with payroll credits),
// eligible pension income and the pension credit, age amounts, eligible
// dividends, capital gains (50% inclusion), RRSP deductions, pension income
// splitting, OAS recovery tax, Ontario surtax/tax reduction/health premium,
// the BC low-income reduction and the Manitoba BPA phase-out. It does not
// model refundable credits, AMT, or less common deductions and credits.

export interface IncomeTaxInput {
  province: ProvinceCode
  age: number
  employment: number
  // Registered pension plan income and annuities: eligible pension income at any age.
  pension: number
  // RRSP/RRIF/LIF withdrawals: eligible pension income (as RRIF income) at 65+.
  registeredWithdrawals: number
  cpp: number
  oas: number
  otherOrdinary: number
  eligibleDividends: number // actual amount received
  capitalGains: number // realized gains before the inclusion rate
  rrspDeduction: number
  // Eligible pension income split to (+) or from (−) this person.
  pensionSplit: number
}

export interface IncomeTaxResult {
  netIncome: number
  taxableIncome: number
  federal: number
  provincial: number
  oasClawback: number
  // Income tax including the OAS clawback and Ontario Health Premium.
  total: number
  payroll: PayrollContributions
}

export interface TaxOptions {
  // Real value of frozen (non-indexed) provincial thresholds and credits in
  // this year: 1 at the plan start, 1 / CPI later.
  deflator?: number
  data?: TaxYearData
}

export const CAPITAL_GAINS_INCLUSION = 0.5

export function emptyIncome(province: ProvinceCode, age: number): IncomeTaxInput {
  return {
    province, age, employment: 0, pension: 0, registeredWithdrawals: 0, cpp: 0, oas: 0,
    otherOrdinary: 0, eligibleDividends: 0, capitalGains: 0, rrspDeduction: 0, pensionSplit: 0,
  }
}

// Eligible pension income for the pension credit and for splitting.
export function eligiblePensionIncome(input: Pick<IncomeTaxInput, 'age' | 'pension' | 'registeredWithdrawals'>): number {
  return Math.max(0, input.pension) + (input.age >= 65 ? Math.max(0, input.registeredWithdrawals) : 0)
}

export function computeIncomeTax(input: IncomeTaxInput, opts: TaxOptions = {}): IncomeTaxResult {
  const data = opts.data ?? getTaxYear()
  const deflator = opts.deflator ?? 1
  const fed = data.federal
  const prov = data.provinces[input.province]
  const payroll = payrollContributions(input.employment, input.province, data)

  const grossedUpDividends = Math.max(0, input.eligibleDividends) * (1 + fed.eligibleDividendGrossUp)
  const netIncome = Math.max(0,
    Math.max(0, input.employment) +
    Math.max(0, input.pension) +
    Math.max(0, input.registeredWithdrawals) +
    Math.max(0, input.cpp) +
    Math.max(0, input.oas) +
    input.otherOrdinary +
    grossedUpDividends +
    Math.max(0, input.capitalGains) * CAPITAL_GAINS_INCLUSION +
    input.pensionSplit -
    Math.max(0, input.rrspDeduction) -
    payroll.pensionEnhanced,
  )

  const oasClawback = Math.min(
    Math.max(0, input.oas),
    data.oas.recoveryRate * Math.max(0, netIncome - data.oas.clawbackThreshold),
  )
  // The recovery tax is deductible, so the taxable income excludes it.
  const taxableIncome = Math.max(0, netIncome - oasClawback)

  const eligiblePension = Math.max(0, eligiblePensionIncome(input) + input.pensionSplit)
  const payrollCredit = payroll.pensionBase + payroll.ei + payroll.qpip

  // --- Federal
  let federalCredits = phaseOut(netIncome, fed.basicPersonal.max, fed.basicPersonal.min, fed.basicPersonal.phaseOutStart, fed.basicPersonal.phaseOutEnd)
  if (input.age >= 65) federalCredits += Math.max(0, fed.ageAmount - fed.ageReductionRate * Math.max(0, netIncome - fed.ageThreshold))
  federalCredits += Math.min(fed.pensionAmount, eligiblePension)
  federalCredits += payrollCredit
  federalCredits += Math.min(fed.canadaEmploymentAmount, Math.max(0, input.employment))
  const federalDividendCredit = grossedUpDividends * (fed.eligibleDividendCreditPct / 100)
  let federal = Math.max(0, progressiveTax(taxableIncome, fed.brackets) - federalCredits * (fed.creditRatePct / 100) - federalDividendCredit)
  if (input.province === 'QC') federal *= 1 - fed.quebecAbatement

  // --- Provincial
  const scaleBrackets = prov.bracketsIndexed ? 1 : deflator
  const scaleCredits = prov.creditsIndexed ? 1 : deflator
  const basicProvincial = progressiveTax(taxableIncome, prov.brackets, scaleBrackets)
  const provincialDividendCredit = grossedUpDividends * (prov.eligibleDividendCreditPct / 100)
  let provincial: number
  let healthPremium = 0

  if (input.province === 'QC') {
    let credits = prov.basicPersonal
    if (input.age >= 65) {
      const retirementAmount = Math.min(data.quebec.retirementIncomeAmount, eligiblePension * 1.25)
      const eligible = prov.ageAmount + retirementAmount
      const reduction = Math.min(eligible, data.quebec.creditReductionRate * Math.max(0, netIncome - data.quebec.creditReductionThreshold))
      credits += eligible - reduction
    }
    provincial = Math.max(0, basicProvincial - credits * (prov.creditRatePct / 100) - provincialDividendCredit)
  } else {
    let basicPersonal = prov.basicPersonal * scaleCredits
    if (input.province === 'MB') {
      basicPersonal = phaseOut(netIncome, basicPersonal, 0, data.manitoba.bpaPhaseOutStart, data.manitoba.bpaPhaseOutEnd)
    } else if (input.province === 'YT') {
      basicPersonal = phaseOut(netIncome, fed.basicPersonal.max, fed.basicPersonal.min, fed.basicPersonal.phaseOutStart, fed.basicPersonal.phaseOutEnd)
    }
    let credits = basicPersonal
    if (input.age >= 65) {
      credits += Math.max(0, prov.ageAmount * scaleCredits - prov.ageReductionRate * Math.max(0, netIncome - prov.ageThreshold * scaleCredits))
    }
    credits += Math.min(prov.pensionAmount * scaleCredits, eligiblePension)
    credits += payrollCredit
    provincial = Math.max(0, basicProvincial - credits * (prov.creditRatePct / 100) - provincialDividendCredit)

    if (input.province === 'ON') {
      const s = data.ontario.surtax
      const surtax = s.rate1 * Math.max(0, provincial - s.threshold1) + s.rate2 * Math.max(0, provincial - s.threshold2)
      const withSurtax = provincial + surtax
      const reduction = Math.min(withSurtax, Math.max(0, 2 * data.ontario.taxReductionBasic - withSurtax))
      provincial = withSurtax - reduction
      healthPremium = ontarioHealthPremium(taxableIncome, data)
    } else if (input.province === 'BC') {
      const r = data.britishColumbia
      const reduction = Math.max(0, r.reductionMax - r.reductionRate * Math.max(0, netIncome - r.reductionThreshold))
      provincial = Math.max(0, provincial - reduction)
    }
  }

  provincial += healthPremium

  return {
    netIncome,
    taxableIncome,
    federal,
    provincial,
    oasClawback,
    total: federal + provincial + oasClawback,
    payroll,
  }
}

export function ontarioHealthPremium(taxableIncome: number, data: TaxYearData = getTaxYear()): number {
  let premium = 0
  for (const [from, base, rate, cap] of data.ontario.healthPremium) {
    if (taxableIncome > from) premium = Math.min(cap, base + rate * (taxableIncome - from))
  }
  return premium
}

// Combined marginal rate on one more dollar of ordinary income, in percent.
export function marginalTaxRate(input: IncomeTaxInput, opts: TaxOptions = {}, step = 100): number {
  const base = computeIncomeTax(input, opts).total
  const bumped = computeIncomeTax({ ...input, otherOrdinary: input.otherOrdinary + step }, opts).total
  return ((bumped - base) / step) * 100
}
