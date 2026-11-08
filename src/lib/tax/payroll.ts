import type { ProvinceCode } from '@/lib/plan/schema'
import type { TaxYearData } from './data/2026'

export interface PayrollContributions {
  // Base CPP/QPP contributions earn a non-refundable credit.
  pensionBase: number
  // Enhanced (first and second additional) contributions are deductible.
  pensionEnhanced: number
  // The employer's half of base contributions on self-employment: deductible.
  selfEmployedEmployerBase: number
  ei: number
  qpip: number
  total: number
}

export interface PayrollOptions {
  age?: number
  selfEmployment?: number
}

// CPP stops at 70. QPP stops on January 1 after the 72nd birthday, which is
// the year the person turns 73. Stopping earlier by election is not assumed.
function pensionContributionsEnd(province: ProvinceCode): number {
  return province === 'QC' ? 73 : 70
}

// CPP/QPP, EI and QPIP. Wages use the employee rates. Self-employed people pay
// both halves of CPP/QPP on what wages have not already covered, and EI is
// optional for them, so it is left out.
export function payrollContributions(employment: number, province: ProvinceCode, data: TaxYearData, opts: PayrollOptions = {}): PayrollContributions {
  const p = data.payroll
  const wages = Math.max(0, employment)
  const selfEmployed = Math.max(0, opts.selfEmployment ?? 0)
  const contributes = opts.age === undefined || opts.age < pensionContributionsEnd(province)
  const rates = province === 'QC' ? p.qpp : p.cpp

  const base = (e: number) => Math.max(0, Math.min(e, p.ympe) - p.basicExemption)
  const additional = (e: number) => Math.max(0, Math.min(e, p.yampe) - p.ympe)
  const wageBase = contributes ? base(wages) : 0
  const wageAdditional = contributes ? additional(wages) : 0
  const selfBase = contributes ? base(wages + selfEmployed) - wageBase : 0
  const selfAdditional = contributes ? additional(wages + selfEmployed) - wageAdditional : 0

  const pensionBase = (wageBase + selfBase) * rates.baseRate
  const selfEmployedEmployerBase = selfBase * rates.baseRate
  const enhanced = (pensionable: number, above: number) => pensionable * rates.firstAdditionalRate + above * rates.secondAdditionalRate
  const pensionEnhanced = enhanced(wageBase, wageAdditional) + 2 * enhanced(selfBase, selfAdditional)

  const ei = Math.min(wages, p.ei.maxInsurable) * (province === 'QC' ? p.ei.quebecRate : p.ei.rate)
  const qpipWages = Math.min(wages, p.qpip.maxInsurable)
  const qpipSelf = Math.min(wages + selfEmployed, p.qpip.maxInsurable) - qpipWages
  const qpip = province === 'QC' ? qpipWages * p.qpip.rate + qpipSelf * p.qpip.selfEmployedRate : 0

  return { pensionBase, pensionEnhanced, selfEmployedEmployerBase, ei, qpip, total: pensionBase + selfEmployedEmployerBase + pensionEnhanced + ei + qpip }
}
