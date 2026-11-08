import { describe, it, expect } from 'vitest'
import { planSchema, type PlanV2, type PlanV2Input } from '@/lib/plan/schema'
import { simulatePlan } from '@/lib/sim'
import { buildSankeyData } from '@/lib/insights/sankey'
import { toCsv } from '@/lib/insights/csv'
import { buildYearTable, YEAR_TABLE_HEADERS } from '@/lib/insights/yearTable'
import { fiMetrics, withRetirementIn } from '@/lib/insights/fi'
import { buildMilestones } from '@/lib/insights/milestones'
import { comparePlans } from '@/lib/insights/compare'
import { bracketPosition } from '@/lib/insights/brackets'
import { createDefaultPlan } from '@/lib/plan/defaults'
import { accountCategory, buildAccountBreakdown, categoriesInUse } from '@/lib/insights/accountBreakdown'

const YEAR = 2026

function plan(overrides: Partial<PlanV2Input> = {}): PlanV2 {
  return planSchema.parse({
    schemaVersion: 2, id: 'p', name: 'Base', asOf: '2026-01-01',
    people: [{ id: 'a', name: 'A', birthYear: YEAR - 45, retirementAge: 65, province: 'ON' }],
    accounts: [
      { id: 'r', ownerId: 'a', type: 'RRSP', balance: 300000, contributions: [{ amount: 15000 }] },
      { id: 't', ownerId: 'a', type: 'TFSA', balance: 100000, contributions: [{ amount: 7000 }] },
    ],
    incomes: [{ id: 'job', ownerId: 'a', kind: 'employment', amount: 110000, to: { kind: 'retirement', personId: 'a' } }],
    debts: [{ id: 'm', kind: 'mortgage', balance: 50000, interestRatePct: 4, monthlyPayment: 1500 }],
    ...overrides,
  })
}

describe('cash-flow Sankey', () => {
  it('balances inflows and outflows and drops empty flows', () => {
    const { result } = simulatePlan(plan(), { startYear: YEAR })
    for (const row of [result.rows[0], result.rows[25]]) {
      const data = buildSankeyData(row)
      const hub = data.nodes.findIndex(n => n.kind === 'hub')
      const inflow = data.links.filter(l => l.target === hub).reduce((s, l) => s + l.value, 0)
      const outflow = data.links.filter(l => l.source === hub).reduce((s, l) => s + l.value, 0)
      expect(outflow).toBeCloseTo(inflow, 4)
      expect(data.links.every(l => l.value > 0)).toBe(true)
      // Every node is used by a link.
      data.nodes.forEach((_, i) => expect(data.links.some(l => l.source === i || l.target === i)).toBe(true))
    }
  })

  it('shows employment while working and withdrawals in retirement', () => {
    const { result, compiled } = simulatePlan(plan(), { startYear: YEAR })
    const working = buildSankeyData(result.rows[0]).nodes.map(n => n.name)
    const retired = buildSankeyData(result.rows[compiled.drawdownStartOffset + 1]).nodes.map(n => n.name)
    expect(working).toContain('Employment')
    expect(working).toContain('Savings & contributions')
    expect(retired).toContain('Portfolio withdrawals')
    expect(retired).not.toContain('Employment')
  })
})

describe('CSV export', () => {
  it('escapes quotes, commas and newlines', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'say "hi"'], [1.234, null]])).toBe('a,b\r\n"x,y","say ""hi"""\r\n1.23,')
  })

  it('exports one row per simulated year', () => {
    const { compiled, result } = simulatePlan(plan(), { startYear: YEAR })
    const rows = buildYearTable(compiled, result, true)
    expect(rows).toHaveLength(compiled.years)
    expect(rows[0]).toHaveLength(YEAR_TABLE_HEADERS.length)
    expect(rows[0][0]).toBe(YEAR)
    expect(rows[0][2]).toBe('Working')
  })
})

describe('financial independence', () => {
  it('finds an FI year no later than retirement and a Coast FI year no later than FI', () => {
    const fi = fiMetrics(plan(), YEAR)
    expect(fi.onTrack).toBe(true)
    expect(fi.fiYear).not.toBeNull()
    expect(fi.fiYear!).toBeLessThanOrEqual(YEAR + 20)
    expect(fi.coastYear!).toBeLessThanOrEqual(fi.fiYear!)
  })

  it('judges FI against spending, not a fixed withdrawal rate', () => {
    // The starter plan (35, $180k saved) uses a 4% fixed-rate strategy, which
    // can always pay 4% of whatever exists; FI must still be decades away.
    const starter = createDefaultPlan(new Date('2026-06-01'))
    const fi = fiMetrics(starter, YEAR)
    expect(fi.fiYear === null || fi.fiYear > YEAR + 10).toBe(true)
  })

  it('has no FI date for a plan that does not work', () => {
    const broke = plan({ accounts: [], drawdown: { strategy: { kind: 'expenses' } } })
    expect(fiMetrics(broke, YEAR)).toEqual({ onTrack: false, fiYear: null, coastYear: null })
  })

  it('moves retirement earlier without moving later retirements', () => {
    const p = withRetirementIn(plan(), YEAR + 5)
    expect(p.people[0].retirementAge).toBe(50)
  })
})

describe('milestones', () => {
  it('lists retirement, benefits, RRIF conversion and debt payoff in date order', () => {
    const p = plan()
    const { compiled, result } = simulatePlan(p, { startYear: YEAR })
    const milestones = buildMilestones(p, compiled, result, { onTrack: true, fiYear: YEAR + 10, coastYear: YEAR + 5 })
    const labels = milestones.map(m => m.label)
    expect(labels).toContain('Retire at 65')
    expect(labels).toContain('CPP starts at 65')
    expect(labels).toContain('RRSP converts to a RRIF')
    expect(labels).toContain('Debt-free')
    expect(labels).toContain('Financially independent')
    const years = milestones.map(m => m.year)
    expect(years).toEqual([...years].sort((a, b) => a - b))
  })
})

describe('plan comparison', () => {
  it('compares retirement timing and outcomes in today’s dollars', () => {
    const base = plan()
    const early = { ...plan({ people: [{ id: 'a', name: 'A', birthYear: YEAR - 45, retirementAge: 60, province: 'ON' }] }), id: 'q', name: 'Early' }
    const [a, b] = comparePlans([base, early], YEAR)
    expect(a.name).toBe('Base')
    expect(b.retirementYear).toBe(a.retirementYear - 5)
    expect(b.portfolioAtRetirement).toBeLessThan(a.portfolioAtRetirement)
    expect(a.netWorth.length).toBeGreaterThan(40)
  })
})

describe('tax bracket position', () => {
  it('finds the combined marginal rate and the room to the next bracket', () => {
    const on = bracketPosition(50000, 'ON')
    expect(on.marginalRatePct).toBeCloseTo(14 + 5.05, 6)
    expect(on.nextThreshold).toBe(53891)
    expect(on.room).toBe(3891)
    const qc = bracketPosition(60000, 'QC')
    expect(qc.marginalRatePct).toBeCloseTo(20.5 * 0.835 + 19, 6)
  })
})

describe('account breakdown', () => {
  const mixed = () => plan({
    accounts: [
      { id: 'r', ownerId: 'a', type: 'RRSP', balance: 300000 },
      { id: 'f', ownerId: 'a', type: 'RRIF', balance: 50000 },
      { id: 't', ownerId: 'a', type: 'TFSA', balance: 100000 },
      { id: 'c', ownerId: 'a', type: 'CASH', balance: 20000 },
      { id: 'l', ownerId: 'a', type: 'LIRA', balance: 40000 },
      { id: 's', ownerId: 'a', type: 'STOCK', balance: 0, holdings: [{ id: 'h', symbol: 'ACME', shares: 1000, priceUsd: 50 }] },
    ],
  })

  it('maps every account type to one category, RRSP and RRIF together', () => {
    expect(accountCategory('RRSP')).toBe('rrsp')
    expect(accountCategory('RRIF')).toBe('rrsp')
    expect(accountCategory('LIF')).toBe('lockedIn')
    expect(accountCategory('STOCK')).toBe('stock')
    expect(accountCategory('CASH')).toBe('cash')
  })

  it('splits balances and withdrawals by category without losing any money', () => {
    const { compiled, result } = simulatePlan(mixed(), { startYear: YEAR })
    const rows = buildAccountBreakdown(compiled, result, false)
    expect(rows).toHaveLength(result.rows.length)
    rows.forEach((r, i) => {
      const row = result.rows[i]
      const balances = Object.values(r.balances).reduce((s, v) => s + v, 0)
      const withdrawals = Object.values(r.withdrawals).reduce((s, v) => s + v, 0)
      expect(balances).toBeCloseTo(row.balancesStart.reduce((s, b) => s + b, 0), 4)
      expect(withdrawals).toBeCloseTo(row.withdrawal, 4)
      expect(row.withdrawalsByAccount.reduce((s, v) => s + v, 0)).toBeCloseTo(row.withdrawal, 4)
    })
    // Non-registered appears too: unneeded RRIF minimums are reinvested in one.
    expect(categoriesInUse(rows, 'balances')).toEqual(['rrsp', 'stock', 'tfsa', 'nonreg', 'lockedIn', 'cash'])
    // Retirement is funded from several accounts.
    expect(categoriesInUse(rows.filter(r => r.phase === 'drawdown'), 'withdrawals').length).toBeGreaterThan(1)
  })

  it("shows today's dollars when asked", () => {
    const { compiled, result } = simulatePlan(mixed(), { startYear: YEAR })
    const nominal = buildAccountBreakdown(compiled, result, false)
    const real = buildAccountBreakdown(compiled, result, true)
    const t = 25
    expect(real[t].withdrawals.rrsp).toBeCloseTo(nominal[t].withdrawals.rrsp / result.rows[t].cpi, 4)
    expect(real[t].balances.tfsa).toBeCloseTo(nominal[t].balances.tfsa / result.rows[t].cpi, 4)
  })
})
