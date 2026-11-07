import type { ProjectionDataPoint } from '@/types/projection'
import type { CompiledPlan, SimResult } from './types'

// Shapes simulation output into the series the existing charts and tables use.
// The household age axis is the youngest person's age, as in the original app.

export interface CashFlowRow {
  age: number
  year: number
  cpp: number
  oas: number
  pension: number
  rrspWithdrawal: number
  tfsaWithdrawal: number
  portfolioWithdrawal: number
  grossIncome: number
  tax: number
  oasClawback: number
  afterTaxIncome: number
  portfolioEnd: number
}

export function householdBaseAge(c: CompiledPlan): number {
  return c.startYear - Math.max(...c.people.map(p => p.birthYear))
}

function sumWhere(c: CompiledPlan, balances: number[], type: 'RRSP' | 'TFSA'): number {
  return c.accounts.reduce((s, a, i) => s + (a.type === type ? balances[i] : 0), 0)
}

// v1 charts hid a series when no account of that type had money or contributions.
function hasSeries(c: CompiledPlan, type: 'RRSP' | 'TFSA'): boolean {
  return c.accounts.some((a, i) => a.type === type && (
    a.initialBalance > 0 || a.contributions.some(f => f.amount > 0) || c.refundTargets.includes(i)
  ))
}

// Start-of-year balances from today through the first drawdown year.
export function toProjectionData(c: CompiledPlan, result: SimResult, showRealValues: boolean): ProjectionDataPoint[] {
  const baseAge = householdBaseAge(c)
  const showRrsp = hasSeries(c, 'RRSP')
  const showTfsa = hasSeries(c, 'TFSA')
  return result.rows.slice(0, c.drawdownStartOffset + 1).map(row => {
    const scale = showRealValues ? 1 / row.cpi : 1
    const total = row.balancesStart.reduce((s, b) => s + b, 0)
    return {
      year: row.year,
      age: baseAge + row.offset,
      RRSP: showRrsp ? sumWhere(c, row.balancesStart, 'RRSP') * scale : undefined,
      TFSA: showTfsa ? sumWhere(c, row.balancesStart, 'TFSA') * scale : undefined,
      Total: total * scale,
    }
  })
}

export function toCashFlowRows(c: CompiledPlan, result: SimResult, showRealValues: boolean): CashFlowRow[] {
  const baseAge = householdBaseAge(c)
  return result.rows.slice(c.drawdownStartOffset).map(row => {
    const scale = showRealValues ? 1 / row.cpi : 1
    const cpp = row.people.reduce((s, p) => s + p.cpp, 0)
    const oas = row.people.reduce((s, p) => s + p.oas, 0)
    const pension = row.people.reduce((s, p) => s + p.pension, 0)
    return {
      age: baseAge + row.offset,
      year: row.year,
      cpp: cpp * scale,
      oas: oas * scale,
      pension: pension * scale,
      rrspWithdrawal: row.taxableWithdrawal * scale,
      tfsaWithdrawal: row.taxFreeWithdrawal * scale,
      portfolioWithdrawal: row.withdrawal * scale,
      grossIncome: row.grossIncome * scale,
      tax: row.tax * scale,
      oasClawback: row.oasClawback * scale,
      afterTaxIncome: row.afterTaxIncome * scale,
      portfolioEnd: row.balancesEnd.reduce((s, b) => s + b, 0) / (showRealValues ? row.cpiEnd : 1),
    }
  })
}
