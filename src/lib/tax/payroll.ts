import type { ProvinceCode } from '@/lib/plan/schema'
import type { TaxYearData } from './data/2026'

export interface PayrollContributions {
  // Base CPP/QPP contributions earn a non-refundable credit.
  pensionBase: number
  // Enhanced (first and second additional) contributions are deductible.
  pensionEnhanced: number
  ei: number
  qpip: number
  total: number
}

// Employee CPP/QPP, EI and QPIP contributions on employment income.
// Self-employed contributions (both halves) are not modelled separately.
export function payrollContributions(employment: number, province: ProvinceCode, data: TaxYearData): PayrollContributions {
  const p = data.payroll
  const earnings = Math.max(0, employment)
  const pensionable = Math.max(0, Math.min(earnings, p.ympe) - p.basicExemption)
  const rates = province === 'QC' ? p.qpp : p.cpp
  const pensionBase = pensionable * rates.baseRate
  const pensionEnhanced = pensionable * rates.firstAdditionalRate +
    Math.max(0, Math.min(earnings, p.yampe) - p.ympe) * rates.secondAdditionalRate
  const ei = Math.min(earnings, p.ei.maxInsurable) * (province === 'QC' ? p.ei.quebecRate : p.ei.rate)
  const qpip = province === 'QC' ? Math.min(earnings, p.qpip.maxInsurable) * p.qpip.rate : 0
  return { pensionBase, pensionEnhanced, ei, qpip, total: pensionBase + pensionEnhanced + ei + qpip }
}
