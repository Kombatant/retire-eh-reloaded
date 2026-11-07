import { describe, it, expect } from 'vitest'
import { planSchema, type PlanV2, type PlanV2Input } from '@/lib/plan/schema'
import { compilePlan, simulate, deterministicPath } from '@/lib/sim'
import { mulberry32 } from '@/lib/sim/rng'
import { lognormalReturn, monteCarloPath } from '@/lib/sim/paths/monteCarlo'
import { HISTORICAL_DATA, historicalPath, overlayPath } from '@/lib/sim/paths/historical'
import { runBacktest, runCrashScenarios, runMonteCarlo, runMonteCarloBatch, settingsFromPlan, summarizeRuns } from '@/lib/sim/risk'

const YEAR = 2026

function plan(overrides: Partial<PlanV2Input> = {}): PlanV2 {
  return planSchema.parse({
    schemaVersion: 2, id: 'p', asOf: '2026-01-01',
    people: [{ id: 'a', name: 'A', birthYear: YEAR - 60, retirementAge: 65, province: 'ON' }],
    accounts: [
      { id: 'r', ownerId: 'a', type: 'RRSP', balance: 600000, contributions: [{ amount: 10000 }] },
      { id: 't', ownerId: 'a', type: 'TFSA', balance: 150000, allocation: { equity: 60, bond: 40, cash: 0 } },
    ],
    incomes: [{ id: 'job', ownerId: 'a', kind: 'employment', amount: 90000, to: { kind: 'retirement', personId: 'a' } }],
    assumptions: { simulation: { runs: 60 } },
    ...overrides,
  })
}

describe('market paths', () => {
  it('draws lognormal returns with the requested mean', () => {
    const rng = mulberry32(3)
    let total = 0
    const n = 40000
    for (let i = 0; i < n; i++) {
      let u = 0
      while (u === 0) u = rng()
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
      total += lognormalReturn(0.07, 0.16, z)
    }
    expect(total / n).toBeCloseTo(0.07, 2)
    expect(lognormalReturn(0.05, 0, 3)).toBe(0.05)
  })

  it('is reproducible for a seed and matches the deterministic path at zero volatility', () => {
    const p = plan()
    const c = compilePlan(p, { startYear: YEAR })
    const s = { ...settingsFromPlan(p), portfolioVolPct: 0, equityVolPct: 0, bondVolPct: 0, cashVolPct: 0, stochasticInflation: false }
    const path = monteCarloPath(c, s, mulberry32(1))
    expect(path.nominalReturn[5]).toBeCloseTo(c.expectedReturnPct / 100, 12)
    const a = runMonteCarloBatch(c, settingsFromPlan(p), 9, 0, 5)
    const b = runMonteCarloBatch(c, settingsFromPlan(p), 9, 0, 5)
    expect(a.portfolios.map(x => x[20])).toEqual(b.portfolios.map(x => x[20]))

    // Zero volatility everywhere: Monte Carlo collapses to the deterministic plan,
    // except allocation accounts follow their asset-class mix.
    const flat = compilePlan(plan({ accounts: [{ id: 'r', ownerId: 'a', type: 'RRSP', balance: 600000 }] }), { startYear: YEAR })
    const zero = simulate(flat, monteCarloPath(flat, s, mulberry32(2)))
    const det = simulate(flat, deterministicPath(flat.years, flat.expectedReturnPct, flat.inflationPct))
    expect(zero.rows.at(-1)!.balancesEnd[0]).toBeCloseTo(det.rows.at(-1)!.balancesEnd[0], 4)
  })

  it('gives the same result regardless of batch size', () => {
    const p = plan()
    const c = compilePlan(p, { startYear: YEAR })
    const s = settingsFromPlan(p)
    const whole = runMonteCarloBatch(c, s, 4, 0, 10)
    const split = runMonteCarloBatch(c, s, 4, 5, 5, runMonteCarloBatch(c, s, 4, 0, 5))
    expect(summarizeRuns(c, split.portfolios, split.successes, split.estates).bands[30])
      .toEqual(summarizeRuns(c, whole.portfolios, whole.successes, whole.estates).bands[30])
  })

  it('wraps historical sequences around the data', () => {
    const c = compilePlan(plan(), { startYear: YEAR })
    const last = HISTORICAL_DATA.length - 1
    const path = historicalPath(c, last, { equity: 100, bond: 0, cash: 0 })
    expect(path.nominalReturn[0]).toBe(HISTORICAL_DATA[last].equity)
    expect(path.nominalReturn[1]).toBe(HISTORICAL_DATA[0].equity)
    expect(path.inflation[1]).toBe(HISTORICAL_DATA[0].inflation)
  })

  it('overlays a historical crash at the chosen offset', () => {
    const c = compilePlan(plan(), { startYear: YEAR })
    const path = overlayPath(c, 5, 2008, 2, { equity: 100, bond: 0, cash: 0 })
    expect(path.assets!.equity[5]).toBeCloseTo(HISTORICAL_DATA.find(y => y.year === 2008)!.equity, 10)
    expect(path.nominalReturn[4]).toBeCloseTo(c.expectedReturnPct / 100, 10)
    expect(path.nominalReturn[7]).toBeCloseTo(c.expectedReturnPct / 100, 10)
  })
})

describe('risk summaries', () => {
  it('summarizes Monte Carlo runs into ordered percentile bands', () => {
    const summary = runMonteCarlo(plan(), YEAR, 60)
    expect(summary.runs).toBe(60)
    expect(summary.successRate).toBeGreaterThanOrEqual(0)
    expect(summary.successRate).toBeLessThanOrEqual(1)
    for (const b of summary.bands) {
      expect(b.p10).toBeLessThanOrEqual(b.p25)
      expect(b.p25).toBeLessThanOrEqual(b.p50)
      expect(b.p50).toBeLessThanOrEqual(b.p75)
      expect(b.p75).toBeLessThanOrEqual(b.p90)
    }
  })

  it('makes a richer plan at least as likely to succeed', () => {
    const lean = runMonteCarlo(plan({ drawdown: { strategy: { kind: 'initialPct', ratePct: 7 } } }), YEAR, 60)
    const rich = runMonteCarlo(plan({ drawdown: { strategy: { kind: 'initialPct', ratePct: 3 } } }), YEAR, 60)
    expect(rich.successRate).toBeGreaterThanOrEqual(lean.successRate)
  })

  it('backtests one window per historical start year', () => {
    const result = runBacktest(plan(), YEAR)
    expect(result.windows).toHaveLength(HISTORICAL_DATA.length)
    expect(result.windows[0].startYear).toBe(HISTORICAL_DATA[0].year)
    expect(result.successRate).toBeGreaterThan(0)
  })

  it('runs every crash scenario', () => {
    const crashes = runCrashScenarios(plan(), YEAR)
    expect(crashes.map(c => c.id)).toEqual(['gfc', 'dotcom', 'stagflation'])
    const gfc = crashes[0]
    expect(gfc.minReal).toBeLessThan(gfc.baselineEndingReal + 1e9)
  })
})
