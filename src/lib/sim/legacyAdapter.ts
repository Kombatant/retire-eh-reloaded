import type { ProjectionDataPoint } from '@/types/projection'
import type { CompiledPlan, SimResult } from './types'
import { accountGroup, type AccountGroup } from '@/lib/plan/accountGroups'

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

// Chart series: RRSP = all tax-deferred registered accounts, TFSA, and
// Other = non-registered and cash.
function sumWhere(c: CompiledPlan, balances: number[], group: AccountGroup): number {
  return c.accounts.reduce((s, a, i) => s + (accountGroup(a.type) === group ? balances[i] : 0), 0)
}

// v1 charts hid a series when no account of that type had money or contributions.
function hasSeries(c: CompiledPlan, group: AccountGroup): boolean {
  return c.accounts.some((a, i) => accountGroup(a.type) === group && (
    a.initialBalance > 0 || a.contributions.some(f => f.amount > 0) || c.refundTargets.includes(i)
  ))
}

// Start-of-year balances from today through the first drawdown year.
export function toProjectionData(c: CompiledPlan, result: SimResult, showRealValues: boolean): ProjectionDataPoint[] {
  const baseAge = householdBaseAge(c)
  const showRrsp = hasSeries(c, 'registered')
  const showTfsa = hasSeries(c, 'tfsa')
  const showOther = hasSeries(c, 'taxable') ||
    result.rows.slice(0, c.drawdownStartOffset + 1).some(r => sumWhere(c, r.balancesStart, 'taxable') > 0)
  return result.rows.slice(0, c.drawdownStartOffset + 1).map(row => {
    const scale = showRealValues ? 1 / row.cpi : 1
    const total = row.balancesStart.reduce((s, b) => s + b, 0)
    return {
      year: row.year,
      age: baseAge + row.offset,
      RRSP: showRrsp ? sumWhere(c, row.balancesStart, 'registered') * scale : undefined,
      TFSA: showTfsa ? sumWhere(c, row.balancesStart, 'tfsa') * scale : undefined,
      ...(showOther ? { Other: sumWhere(c, row.balancesStart, 'taxable') * scale } : {}),
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
