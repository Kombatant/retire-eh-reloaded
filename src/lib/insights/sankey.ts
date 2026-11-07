import type { YearRow } from '@/lib/sim/types'

export interface SankeyNode { name: string; kind: 'source' | 'hub' | 'use' }
export interface SankeyLink { source: number; target: number; value: number }
export interface SankeyData { nodes: SankeyNode[]; links: SankeyLink[]; total: number }

// One year's cash flow: every source of cash flows into a single hub, and the
// hub flows out to tax, savings and spending. Spending is what remains, so
// the two sides always balance. Zero flows are dropped (they break layout).
export function buildSankeyData(row: YearRow, scale = 1): SankeyData {
  const sum = (pick: (p: YearRow['people'][number]) => number) => row.people.reduce((s, p) => s + pick(p), 0)
  const sources: [string, number][] = [
    ['Employment', sum(p => p.employment)],
    ['Pensions', sum(p => p.pension)],
    ['CPP/QPP', sum(p => p.cpp)],
    ['OAS', sum(p => p.oas)],
    ['GIS', sum(p => p.gis)],
    ['Other income', row.otherIncome],
    ['Portfolio withdrawals', row.withdrawal],
  ]
  const inflow = sources.reduce((s, [, v]) => s + Math.max(0, v), 0)

  const taxes: [string, number][] = [
    ['Federal tax', sum(p => p.federal)],
    ['Provincial tax', sum(p => p.provincial)],
    ['OAS clawback', sum(p => p.oasClawback)],
    ['Payroll (CPP/EI)', sum(p => p.payroll)],
  ]
  const savings = row.contributions + row.reinvested + row.saved
  const debt = Math.min(row.debtPayments, row.spending)
  const committed = taxes.reduce((s, [, v]) => s + Math.max(0, v), 0) + savings + debt
  const remaining = inflow - committed
  const uses: [string, number][] = [
    ...taxes,
    ['Savings & contributions', savings],
    ['Debt payments', debt],
    ['Spending', Math.max(0, remaining)],
  ]
  // Outflows above inflow are funded from elsewhere (e.g. a deficit).
  if (remaining < 0) sources.push(['Shortfall', -remaining])

  const nodes: SankeyNode[] = []
  const links: SankeyLink[] = []
  const hub = (): number => {
    let i = nodes.findIndex(n => n.kind === 'hub')
    if (i < 0) {
      nodes.push({ name: 'Cash available', kind: 'hub' })
      i = nodes.length - 1
    }
    return i
  }
  for (const [name, value] of sources) {
    if (value * scale < 0.5) continue
    nodes.push({ name, kind: 'source' })
    links.push({ source: nodes.length - 1, target: -1, value: value * scale })
  }
  const h = hub()
  links.forEach(l => { if (l.target === -1) l.target = h })
  for (const [name, value] of uses) {
    if (value * scale < 0.5) continue
    nodes.push({ name, kind: 'use' })
    links.push({ source: h, target: nodes.length - 1, value: value * scale })
  }
  const total = links.filter(l => l.target === h).reduce((s, l) => s + l.value, 0)
  return { nodes, links, total }
}
