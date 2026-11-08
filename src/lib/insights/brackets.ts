import type { ProvinceCode } from '@/lib/plan/schema'
import { TAX_2026 } from '@/lib/tax/data/2026'

export interface BracketPosition {
  // Combined statutory rate on the next dollar (federal + provincial), %.
  marginalRatePct: number
  // Taxable income where the combined rate next changes (plan-start dollars).
  nextThreshold: number | null
  room: number | null
}

// Where taxable income sits in the federal and provincial brackets. Uses
// statutory bracket rates only (not credits, surtaxes or clawbacks), which is
// what "room in the bracket" usually means.
// `deflator` is 1 / CPI for the year shown: thresholds that are not indexed are
// worth less in plan-start dollars as time passes.
export function bracketPosition(taxableIncome: number, province: ProvinceCode, deflator = 1): BracketPosition {
  const fed = TAX_2026.federal.brackets
  const data = TAX_2026.provinces[province]
  const prov = data.brackets.map(b => ({ ...b, upTo: b.upTo * (!data.bracketsIndexed || b.frozen ? deflator : 1) }))
  const abatement = province === 'QC' ? 1 - TAX_2026.federal.quebecAbatement : 1
  const rateAt = (brackets: typeof fed, income: number) => brackets.find(b => income < b.upTo)?.rate ?? brackets[brackets.length - 1].rate
  const thresholds = [...fed, ...prov].map(b => b.upTo).filter(u => Number.isFinite(u) && u > taxableIncome)
  const nextThreshold = thresholds.length ? Math.min(...thresholds) : null
  return {
    marginalRatePct: rateAt(fed, taxableIncome) * abatement + rateAt(prov, taxableIncome),
    nextThreshold,
    room: nextThreshold === null ? null : nextThreshold - taxableIncome,
  }
}
