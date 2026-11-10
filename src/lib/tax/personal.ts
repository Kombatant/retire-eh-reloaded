import type { ProvinceCode } from '@/lib/plan/schema'
import { getTaxYear, type ProvinceTaxData, type TaxYearData } from './data/2026'
import { phaseOut, progressiveTax } from './core'
import { payrollContributions, type PayrollContributions } from './payroll'
import type { RealValues } from './indexation'

// Personal income tax for any province or territory, in plan-start dollars.
//
// Estimator scope: ordinary income, employment (with payroll credits),
// eligible pension income and the pension credit, age amounts, eligible
// dividends, capital gains (50% inclusion), RRSP deductions, pension income
// splitting, OAS recovery tax, Ontario surtax/tax reduction/health premium,
// the Quebec age and retirement amounts and health services fund, the BC
// and Atlantic low-income reductions and the Manitoba BPA phase-out. It does not
// model refundable credits, AMT, or less common deductions and credits.

export interface IncomeTaxInput {
  province: ProvinceCode
  age: number
  employment: number
  // Registered pension plan income and annuities: eligible pension income at any age.
  pension: number
  // All RRSP/RRIF/LIF/FHSA withdrawals. Taxable income in every case.
  registeredWithdrawals: number
  // The part of registeredWithdrawals that is not eligible pension income,
  // such as a withdrawal from an RRSP not yet converted to a RRIF.
  nonEligibleRegistered?: number
  selfEmployment?: number
  cpp: number
  oas: number
  otherOrdinary: number
  eligibleDividends: number // actual amount received
  capitalGains: number // realized gains before the inclusion rate
  rrspDeduction: number
  // Eligible pension income split to (+) or from (−) this person.
  pensionSplit: number
  // The part of a received split that qualifies for the receiver's own pension
  // credit: under 65, only pension-plan income does. Defaults to all of it.
  pensionSplitCreditable?: number
  // The spouse's net income, when this person claims the spouse amount.
  spouseNetIncome?: number
  // Unused age and pension amounts received from a spouse (Schedule 2).
  transferredFederalCredits?: number
  transferredProvincialCredits?: number
  // A couple's low-income reduction is claimed once, by the household.
  familyLowIncomeHandled?: boolean
  // Quebec return only (Schedule Q). Quebec's split has its own rules and can
  // differ from the federal one. Defaults to `pensionSplit`.
  quebecPensionSplit?: number
  // Quebec line 361, when a household has already worked out the shared amount.
  quebecLine361?: number
}

export interface IncomeTaxResult {
  netIncome: number
  taxableIncome: number
  federal: number
  provincial: number
  oasClawback: number
  // Ontario Health Premium or Quebec health services fund; part of `provincial`.
  healthPremium: number
  // Age and pension amounts this person can't use, available to a spouse.
  federalTransferable: number
  provincialTransferable: number
  // Quebec credits, in dollars of tax, that this person's own tax can't absorb.
  quebecUnusedCredits: number
  // Income tax including the OAS clawback and Ontario Health Premium.
  total: number
  payroll: PayrollContributions
}

export interface TaxOptions {
  // Real value of an amount frozen in nominal dollars in this year: 1 at the
  // plan start, 1 / CPI later.
  deflator?: number
  // What each province's amounts are worth this year, when it has rules beyond
  // a single indexed-or-frozen flag. Without it, those flags are used.
  realValues?: Partial<Record<ProvinceCode, RealValues>>
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
export function eligiblePensionIncome(input: Pick<IncomeTaxInput, 'age' | 'pension' | 'registeredWithdrawals' | 'nonEligibleRegistered'>): number {
  const registered = Math.max(0, input.registeredWithdrawals - (input.nonEligibleRegistered ?? 0))
  return Math.max(0, input.pension) + (input.age >= 65 ? registered : 0)
}

// Net income before the OAS recovery tax. Kept apart so a household can find
// each spouse's income cheaply when working out the spouse amount.
export function netIncomeOf(input: IncomeTaxInput, data: TaxYearData = getTaxYear()): { netIncome: number; payroll: PayrollContributions; grossedUpDividends: number; selfEmployment: number } {
  const selfEmployment = Math.max(0, input.selfEmployment ?? 0)
  const payroll = payrollContributions(input.employment, input.province, data, { age: input.age, selfEmployment })
  const grossedUpDividends = Math.max(0, input.eligibleDividends) * (1 + data.federal.eligibleDividendGrossUp)
  const netIncome = Math.max(0,
    Math.max(0, input.employment) +
    selfEmployment +
    Math.max(0, input.pension) +
    Math.max(0, input.registeredWithdrawals) +
    Math.max(0, input.cpp) +
    Math.max(0, input.oas) +
    input.otherOrdinary +
    grossedUpDividends +
    Math.max(0, input.capitalGains) * CAPITAL_GAINS_INCLUSION +
    input.pensionSplit -
    Math.max(0, input.rrspDeduction) -
    payroll.pensionEnhanced -
    payroll.selfEmployedEmployerBase,
  )
  return { netIncome, payroll, grossedUpDividends, selfEmployment }
}

// The low-income reduction in NL, PE, NS and NB: an amount per family, less a
// percentage of family income over a threshold. `ages` has one entry per spouse.
export function familyLowIncomeReduction(prov: ProvinceTaxData, familyIncome: number, ages: number[], scale: number): number {
  const r = prov.lowIncomeReduction
  if (!r) return 0
  const couple = ages.length === 2
  const amount = r.basic + (couple ? r.spouse : 0) + r.age * ages.filter(age => age >= 65).length
  const threshold = (couple ? r.coupleThreshold ?? r.threshold : r.threshold) * scale
  return Math.max(0, amount * scale - r.rate * Math.max(0, familyIncome - threshold))
}

export function creditScale(province: ProvinceCode, data: TaxYearData, opts: TaxOptions): number {
  return opts.realValues?.[province]?.credits ?? (data.provinces[province].creditsIndexed ? 1 : opts.deflator ?? 1)
}

// Quebec's age and retirement amounts before the family-income reduction
// (Schedule B). The retirement amount needs no particular age: any amount on line
// 122 or 123 qualifies, which is RRSP, RRIF and pension-plan income, less what was
// transferred to a spouse. CPP, QPP and OAS never do.
export function quebecOwnAmounts(input: Pick<IncomeTaxInput, 'age' | 'pension' | 'registeredWithdrawals'>, quebecSplit: number, data: TaxYearData = getTaxYear()): number {
  const retirementIncome = Math.max(0, Math.max(0, input.pension) + Math.max(0, input.registeredWithdrawals) + quebecSplit)
  const retirement = Math.min(data.quebec.retirementIncomeAmount, retirementIncome * 1.25)
  return (input.age >= 65 ? data.provinces.QC.ageAmount : 0) + retirement
}

// Schedule B, Part B: one reduction, on the couple's combined income.
export function quebecAmountsAfterReduction(amounts: number, familyIncome: number, data: TaxYearData = getTaxYear()): number {
  return Math.max(0, amounts - data.quebec.creditReductionRate * Math.max(0, familyIncome - data.quebec.creditReductionThreshold))
}

// Schedule F: the health services fund, on income other than employment
// income and the OAS pension. RRSP deductions don't reduce it; a transfer to a
// spouse does, and the spouse who receives it counts it.
function quebecHealthContribution(input: IncomeTaxInput, quebecSplit: number, grossedUpDividends: number, data: TaxYearData): number {
  const income = Math.max(0, input.selfEmployment ?? 0) + Math.max(0, input.pension) + Math.max(0, input.registeredWithdrawals) +
    Math.max(0, input.cpp) + input.otherOrdinary + Math.max(0, input.capitalGains) * CAPITAL_GAINS_INCLUSION +
    grossedUpDividends - (grossedUpDividends - Math.max(0, input.eligibleDividends)) + quebecSplit
  const h = data.quebec.healthContribution
  if (income <= h.lowerThreshold) return 0
  if (income <= h.upperThreshold) return Math.min(h.lowerMax, h.rate * (income - h.lowerThreshold))
  return Math.min(h.upperMax, h.upperBase + h.rate * (income - h.upperThreshold))
}

export function computeIncomeTax(input: IncomeTaxInput, opts: TaxOptions = {}): IncomeTaxResult {
  const data = opts.data ?? getTaxYear()
  const deflator = opts.deflator ?? 1
  const fed = data.federal
  const prov = data.provinces[input.province]
  const { netIncome, payroll, grossedUpDividends } = netIncomeOf(input, data)

  const oasClawback = Math.min(
    Math.max(0, input.oas),
    data.oas.recoveryRate * Math.max(0, netIncome - data.oas.clawbackThreshold),
  )
  // The recovery tax is deductible, so the taxable income excludes it.
  const taxableIncome = Math.max(0, netIncome - oasClawback)

  const received = input.pensionSplit > 0 ? (input.pensionSplitCreditable ?? input.pensionSplit) : input.pensionSplit
  const eligiblePension = Math.max(0, eligiblePensionIncome(input) + received)
  const payrollCredit = payroll.pensionBase + payroll.ei + payroll.qpip

  // --- Federal
  const federalBasic = phaseOut(netIncome, fed.basicPersonal.max, fed.basicPersonal.min, fed.basicPersonal.phaseOutStart, fed.basicPersonal.phaseOutEnd)
  let federalCredits = federalBasic
  if (input.spouseNetIncome !== undefined) federalCredits += Math.max(0, federalBasic - input.spouseNetIncome)
  const federalAge = input.age >= 65 ? Math.max(0, fed.ageAmount - fed.ageReductionRate * Math.max(0, netIncome - fed.ageThreshold)) : 0
  // The $2,000 federal pension amount is not indexed, so it shrinks in real terms.
  const federalPension = Math.min(fed.pensionAmount * deflator, eligiblePension)
  const employmentAmount = Math.min(fed.canadaEmploymentAmount, Math.max(0, input.employment))
  federalCredits += federalAge + federalPension + payrollCredit + employmentAmount + (input.transferredFederalCredits ?? 0)
  // Schedule 2: what is left of these after the spouse's own income uses them.
  const federalTransferable = Math.max(0, federalAge + federalPension - Math.max(0, taxableIncome - federalBasic - payrollCredit - employmentAmount))
  const federalDividendCredit = grossedUpDividends * (fed.eligibleDividendCreditPct / 100)
  let federal = Math.max(0, progressiveTax(taxableIncome, fed.brackets) - federalCredits * (fed.creditRatePct / 100) - federalDividendCredit)
  if (input.province === 'QC') federal *= 1 - fed.quebecAbatement

  // --- Provincial
  const real = opts.realValues?.[input.province]
  const scaleBrackets = real?.brackets ?? (prov.bracketsIndexed ? 1 : deflator)
  const scaleCredits = real?.credits ?? (prov.creditsIndexed ? 1 : deflator)
  const scaleBasic = real?.basicPersonal ?? scaleCredits
  const scalePension = real?.pension ?? (prov.pensionIndexed ? 1 : deflator)
  const quebecSplit = input.quebecPensionSplit ?? input.pensionSplit
  const quebecNet = Math.max(0, netIncome - input.pensionSplit + quebecSplit - oasClawback)
  const basicProvincial = progressiveTax(input.province === 'QC' ? quebecNet : taxableIncome, prov.brackets, scaleBrackets, deflator)
  const provincialDividendCredit = grossedUpDividends * (prov.eligibleDividendCreditPct / 100)
  let provincial: number
  let healthPremium = 0
  let quebecUnusedCredits = 0
  let provincialTransferable = 0

  if (input.province === 'QC') {
    const line361 = input.quebecLine361 ?? quebecAmountsAfterReduction(quebecOwnAmounts(input, quebecSplit, data), quebecNet, data)
    const credits = prov.basicPersonal + line361
    const afterCredits = basicProvincial - credits * (prov.creditRatePct / 100) - provincialDividendCredit
    provincial = Math.max(0, afterCredits)
    quebecUnusedCredits = Math.max(0, -afterCredits)
    healthPremium = quebecHealthContribution(input, quebecSplit, grossedUpDividends, data)
  } else {
    let basicPersonal = prov.basicPersonal * scaleBasic
    if (input.province === 'MB') {
      basicPersonal = phaseOut(netIncome, basicPersonal, 0, data.manitoba.bpaPhaseOutStart, data.manitoba.bpaPhaseOutEnd)
    } else if (input.province === 'YT') {
      basicPersonal = phaseOut(netIncome, fed.basicPersonal.max, fed.basicPersonal.min, fed.basicPersonal.phaseOutStart, fed.basicPersonal.phaseOutEnd)
    }
    const provincialAge = input.age >= 65
      ? Math.max(0, prov.ageAmount * scaleCredits - prov.ageReductionRate * Math.max(0, netIncome - prov.ageThreshold * scaleCredits))
      : 0
    const provincialPension = Math.min(prov.pensionAmount * scalePension, eligiblePension)
    let credits = basicPersonal + provincialAge + provincialPension + payrollCredit + (input.transferredProvincialCredits ?? 0)
    provincialTransferable = Math.max(0, provincialAge + provincialPension - Math.max(0, taxableIncome - basicPersonal - payrollCredit))
    if (input.spouseNetIncome !== undefined) {
      const scale = prov.spousalFollowsBasic ? scaleBasic : scaleCredits
      const amount = input.province === 'YT' ? basicPersonal : prov.spousalAmount * scale
      credits += Math.max(0, amount - Math.max(0, input.spouseNetIncome - prov.spousalThreshold * scale))
    }
    const afterCredits = Math.max(0, basicProvincial - credits * (prov.creditRatePct / 100))

    if (input.province === 'ON') {
      // Form ON428's order: surtax on tax after non-refundable credits, then
      // the dividend credit, then the tax reduction. Taking the dividend credit
      // first would shrink the surtax.
      const s = data.ontario.surtax
      const surtax = s.rate1 * Math.max(0, afterCredits - s.threshold1) + s.rate2 * Math.max(0, afterCredits - s.threshold2)
      const afterDividendCredit = Math.max(0, afterCredits + surtax - provincialDividendCredit)
      const reduction = Math.min(afterDividendCredit, Math.max(0, 2 * data.ontario.taxReductionBasic - afterDividendCredit))
      provincial = afterDividendCredit - reduction
      healthPremium = ontarioHealthPremium(taxableIncome, data, deflator)
    } else {
      provincial = Math.max(0, afterCredits - provincialDividendCredit)
      if (input.province === 'BC') {
        const r = data.britishColumbia
        const reduction = Math.max(0, r.reductionMax * scaleCredits - r.reductionRate * Math.max(0, netIncome - r.reductionThreshold * scaleCredits))
        provincial = Math.max(0, provincial - reduction)
      }
      if (prov.lowIncomeReduction && !input.familyLowIncomeHandled) {
        provincial = Math.max(0, provincial - familyLowIncomeReduction(prov, netIncome - oasClawback, [input.age], scaleCredits))
      }
      if (prov.ageTaxCredit && input.age >= 65 && taxableIncome < prov.ageTaxCredit.incomeBelow * scaleCredits) {
        provincial = Math.max(0, provincial - prov.ageTaxCredit.amount * scaleCredits)
      }
    }
  }

  provincial += healthPremium

  return {
    netIncome,
    taxableIncome,
    federal,
    provincial,
    oasClawback,
    healthPremium,
    quebecUnusedCredits,
    federalTransferable,
    provincialTransferable,
    total: federal + provincial + oasClawback,
    payroll,
  }
}

// The premium's bands are fixed in nominal dollars, so it is worked out in the
// year's own dollars and converted back.
export function ontarioHealthPremium(taxableIncome: number, data: TaxYearData = getTaxYear(), deflator = 1): number {
  const nominalIncome = taxableIncome / deflator
  let premium = 0
  for (const [from, base, rate, cap] of data.ontario.healthPremium) {
    if (nominalIncome > from) premium = Math.min(cap, base + rate * (nominalIncome - from))
  }
  return premium * deflator
}

// Combined marginal rate on one more dollar of ordinary income, in percent.
export function marginalTaxRate(input: IncomeTaxInput, opts: TaxOptions = {}, step = 100): number {
  const base = computeIncomeTax(input, opts).total
  const bumped = computeIncomeTax({ ...input, otherOrdinary: input.otherOrdinary + step }, opts).total
  return ((bumped - base) / step) * 100
}
