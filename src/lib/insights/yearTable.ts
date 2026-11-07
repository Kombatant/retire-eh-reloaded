import type { CompiledPlan, SimResult } from '@/lib/sim/types'
import type { CsvValue } from './csv'

export const YEAR_TABLE_HEADERS = [
  'Year', 'Ages', 'Phase', 'Employment', 'Pensions', 'CPP/QPP', 'OAS', 'GIS', 'Other income',
  'Withdrawals', 'Tax', 'Spending', 'Contributions', 'Portfolio (end)', 'Net worth (end)',
]

// One row per simulated year, in today's dollars or nominal dollars.
export function buildYearTable(c: CompiledPlan, result: SimResult, showRealValues: boolean): CsvValue[][] {
  return result.rows.map(row => {
    const s = showRealValues ? 1 / row.cpi : 1
    const end = showRealValues ? 1 / row.cpiEnd : 1
    const sum = (pick: (p: SimResult['rows'][number]['people'][number]) => number) => row.people.reduce((t, p) => t + pick(p), 0) * s
    return [
      row.year,
      row.people.map((p, i) => (p.alive ? `${c.people[i].name} ${p.age}` : null)).filter(Boolean).join(' / '),
      row.phase === 'drawdown' ? 'Retired' : 'Working',
      sum(p => p.employment),
      sum(p => p.pension),
      sum(p => p.cpp),
      sum(p => p.oas),
      sum(p => p.gis),
      row.otherIncome * s,
      row.withdrawal * s,
      row.tax * s,
      row.spending * s,
      row.contributions * s,
      row.balancesEnd.reduce((t, b) => t + b, 0) * end,
      row.netWorth * end,
    ]
  })
}
