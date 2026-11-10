import type { ProvinceCode } from '@/lib/plan/schema'
import type { CompiledPlan, SimResult } from './types'

export interface PersonTaxSnapshot {
  name: string
  province: ProvinceCode
  ageAtRetirement: number
  pension: number
  cpp: number
  oas: number
  gis: number
  rrifWithdrawal: number
  // Eligible pension income received (+) or transferred (−) through splitting.
  pensionSplit: number
  taxableIncome: number
  federal: number
  provincial: number
  oasClawback: number
  total: number
  marginalRate: number
}

export interface RetirementTaxSnapshot {
  perPerson: PersonTaxSnapshot[]
  guaranteedIncome: number
  portfolioWithdrawal: number
  taxableWithdrawal: number
  taxFreeWithdrawal: number
  // Tax caused by registered withdrawals (including any OAS clawback they trigger).
  rrspTax: number
  totalTax: number
  oasClawback: number
  preTaxIncome: number
  afterTaxIncome: number
  averageTaxRate: number
  effectiveRrspTaxRate: number
  topMarginalRate: number
}

// Tax picture for the first year of drawdown, in display dollars.
export function buildRetirementTaxSnapshot(
  c: CompiledPlan,
  result: SimResult,
  showRealValues: boolean,
): RetirementTaxSnapshot | null {
  const row = result.rows[c.headlineOffset]
  if (!row || !result.snapshot || c.people.length === 0) return null
  const scale = showRealValues ? 1 / row.cpi : 1

  const perPerson = row.people.map((p, i) => ({
    name: c.people[i].name,
    province: c.people[i].province,
    ageAtRetirement: p.age,
    pension: p.pension * scale,
    cpp: p.cpp * scale,
    oas: p.oas * scale,
    gis: p.gis * scale,
    rrifWithdrawal: p.registeredWithdrawals * scale,
    pensionSplit: p.pensionSplit * scale,
    taxableIncome: p.taxableIncome * scale,
    federal: p.federal * scale,
    provincial: p.provincial * scale,
    oasClawback: p.oasClawback * scale,
    total: p.tax * scale,
    marginalRate: result.snapshot!.marginalRatePct[i] ?? 0,
  }))

  const totalTax = row.tax * scale
  const preTaxIncome = row.grossIncome * scale
  const taxableWithdrawal = row.taxableWithdrawal * scale
  const rrspTax = Math.max(0, row.tax - result.snapshot.taxWithoutRegisteredWithdrawals) * scale

  return {
    perPerson,
    guaranteedIncome: row.guaranteedIncome * scale,
    portfolioWithdrawal: row.withdrawal * scale,
    taxableWithdrawal,
    taxFreeWithdrawal: row.taxFreeWithdrawal * scale,
    rrspTax,
    totalTax,
    oasClawback: row.oasClawback * scale,
    preTaxIncome,
    afterTaxIncome: row.afterTaxIncome * scale,
    averageTaxRate: preTaxIncome > 0 ? (totalTax / preTaxIncome) * 100 : 0,
    effectiveRrspTaxRate: taxableWithdrawal > 0 ? Math.min(100, (rrspTax / taxableWithdrawal) * 100) : 0,
    topMarginalRate: perPerson.reduce((max, p) => Math.max(max, p.marginalRate), 0),
  }
}
