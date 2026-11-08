import type { AccountType } from '@/lib/plan/schema'
import type { CompiledPlan, SimResult } from '@/lib/sim/types'
import { householdBaseAge } from '@/lib/sim/legacyAdapter'

// Finer than accountGroup (registered / TFSA / taxable): stock, cash and
// locked-in accounts are kept apart so charts can show where savings sit and
// which accounts pay for each year. RRSPs and RRIFs share a category because
// an RRSP becomes a RRIF part-way through the plan.
// The order is the stacking order and follows the chart palette order.
export const ACCOUNT_CATEGORIES = ['rrsp', 'stock', 'tfsa', 'nonreg', 'lockedIn', 'cash', 'fhsa'] as const
export type AccountCategory = (typeof ACCOUNT_CATEGORIES)[number]

export const ACCOUNT_CATEGORY_LABELS: Record<AccountCategory, string> = {
  rrsp: 'RRSP & RRIF',
  stock: 'Stocks',
  tfsa: 'TFSA',
  nonreg: 'Non-registered',
  lockedIn: 'LIRA & LIF',
  cash: 'Cash & savings',
  fhsa: 'FHSA',
}

export function accountCategory(type: AccountType): AccountCategory {
  switch (type) {
    case 'RRSP':
    case 'RRIF': return 'rrsp'
    case 'LIRA':
    case 'LIF': return 'lockedIn'
    case 'TFSA': return 'tfsa'
    case 'FHSA': return 'fhsa'
    case 'NONREG': return 'nonreg'
    case 'CASH': return 'cash'
    case 'STOCK': return 'stock'
  }
}

export type CategoryAmounts = Record<AccountCategory, number>

export interface AccountBreakdownYear {
  year: number
  age: number
  phase: 'accumulation' | 'drawdown'
  // Start-of-year balances, as on the other savings charts.
  balances: CategoryAmounts
  balanceTotal: number
  // Withdrawals during the year (including RRIF/LIF minimums and meltdown
  // withdrawals that are later reinvested).
  withdrawals: CategoryAmounts
  withdrawalTotal: number
  employment: number
  pension: number
  cpp: number
  oas: number
  gis: number
  otherIncome: number
  // Income tax and payroll deductions.
  tax: number
  // Withdrawn cash that was not needed and went back into savings.
  reinvested: number
  // One-time expenses paid from savings (simple spending mode).
  oneTimeExpenses: number
  afterTaxIncome: number
  shortfall: number
}

const emptyAmounts = (): CategoryAmounts => ({ rrsp: 0, stock: 0, tfsa: 0, nonreg: 0, lockedIn: 0, cash: 0, fhsa: 0 })

export function buildAccountBreakdown(c: CompiledPlan, result: SimResult, showRealValues: boolean): AccountBreakdownYear[] {
  const baseAge = householdBaseAge(c)
  const categories = c.accounts.map(a => accountCategory(a.type))
  return result.rows.map(row => {
    const s = showRealValues ? 1 / row.cpi : 1
    const balances = emptyAmounts()
    const withdrawals = emptyAmounts()
    categories.forEach((cat, i) => {
      balances[cat] += row.balancesStart[i] * s
      withdrawals[cat] += (row.withdrawalsByAccount[i] ?? 0) * s
    })
    const people = (pick: (p: typeof row.people[number]) => number) => row.people.reduce((t, p) => t + pick(p), 0) * s
    return {
      year: row.year,
      age: baseAge + row.offset,
      phase: row.phase,
      balances,
      balanceTotal: row.balancesStart.reduce((t, b) => t + b, 0) * s,
      withdrawals,
      withdrawalTotal: row.withdrawal * s,
      employment: people(p => p.employment),
      pension: people(p => p.pension),
      cpp: people(p => p.cpp),
      oas: people(p => p.oas),
      gis: people(p => p.gis),
      otherIncome: row.otherIncome * s,
      tax: row.tax * s + people(p => p.payroll),
      reinvested: row.reinvested * s,
      oneTimeExpenses: row.oneTimeExpenses * s,
      afterTaxIncome: row.afterTaxIncome * s,
      shortfall: row.shortfall * s,
    }
  })
}

// Categories with money in them at some point, in stacking order.
export function categoriesInUse(rows: AccountBreakdownYear[], field: 'balances' | 'withdrawals'): AccountCategory[] {
  return ACCOUNT_CATEGORIES.filter(cat => rows.some(r => r[field][cat] > 0.5))
}
