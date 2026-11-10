import type { YearRow } from '@/lib/sim/types'

export interface ContributionGrowthPoint {
  age: number
  contributions: number
  growth: number
  total: number
}

// Splits savings at the start of each year into what went in and what the
// markets did, from the engine's own yearly reconciliation. Money in is the
// opening balance, contributions and deposits, stock pay and less any
// withdrawals; growth is what the accounts earned, and can go negative. In
// today's dollars each flow is valued in its own year, so inflation shows up as
// a drag in growth.
export function buildContributionGrowth(rows: YearRow[], firstAge: number, showRealValues: boolean): ContributionGrowthPoint[] {
  if (rows.length === 0) return []
  const total = (row: YearRow) => row.balancesStart.reduce((s, b) => s + b, 0)
  const deflate = (row: YearRow) => (showRealValues ? row.cpi : 1)
  let contributions = total(rows[0]) / deflate(rows[0])
  return rows.map((row, i) => {
    const value = total(row) / deflate(row)
    const point = { age: firstAge + i, contributions, growth: value - contributions, total: value }
    const netIn = row.contributions + row.deposits + row.stockCompensation - row.withdrawal - row.stockTaxWithheld
    contributions += netIn / deflate(row)
    return point
  })
}
