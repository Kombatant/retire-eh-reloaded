import { describe, it, expect } from 'vitest'
import { planSchema, type PlanV2, type PlanV2Input } from '@/lib/plan/schema'
import { compilePlan, simulate, deterministicPath } from '@/lib/sim'
import { mulberry32 } from '@/lib/sim/rng'
import { arithmeticFromCompounded, lognormalReturn, monteCarloPath } from '@/lib/sim/paths/monteCarlo'
import { HISTORICAL_DATA, historicalPath, overlayPath } from '@/lib/sim/paths/historical'
import { runBacktest, runCrashScenarios, runMonteCarlo, runMonteCarloBatch, runSucceeded, settingsFromPlan, summarizeRuns } from '@/lib/sim/risk'
import { analyzeRun, type FailureSummary } from '@/lib/sim/failures'
import { failureCause, failureNotes, fixesForRisk, shortfallSubject } from '@/lib/insights/failureExplanation'
import type { PlanScore, Proposal } from '@/lib/insights/proposals'

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

  it('converts a compounded rate to the mean whose median draw equals it', () => {
    expect(arithmeticFromCompounded(0.05, 0.3)).toBeCloseTo(0.0891, 3)
    expect(lognormalReturn(arithmeticFromCompounded(0.05, 0.3), 0.3, 0)).toBeCloseTo(0.05, 10)
    expect(lognormalReturn(arithmeticFromCompounded(-0.1, 0.5), 0.5, 0)).toBeCloseTo(-0.1, 10)
    expect(arithmeticFromCompounded(0.05, 0)).toBe(0.05)
  })

  it('compounds a typical year at the entered asset-class and portfolio rates', () => {
    const p = plan()
    const c = compilePlan(p, { startYear: YEAR })
    const s = settingsFromPlan(p)
    const equity: number[] = []
    const portfolio: number[] = []
    for (let seed = 1; seed <= 400; seed++) {
      const path = monteCarloPath(c, s, mulberry32(seed))
      equity.push(...path.assets!.equity)
      portfolio.push(...path.nominalReturn)
    }
    const median = (v: number[]) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)]
    expect(Math.abs(median(equity) - c.assetReturnsPct.equity / 100)).toBeLessThan(0.01)
    expect(Math.abs(median(portfolio) - c.expectedReturnPct / 100)).toBeLessThan(0.01)
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
    const spending = (replacementRate: number) => plan({ expenses: { mode: 'simple', replacementRate }, drawdown: { strategy: { kind: 'expenses' } } })
    const lean = runMonteCarlo(spending(120), YEAR, 60)
    const rich = runMonteCarlo(spending(40), YEAR, 60)
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
    expect(crashes.map(c => c.id)).toEqual(['gfc', 'dotcom', 'stagflation', 'longevity-5', 'longevity-10'])
    const gfc = crashes[0]
    expect(gfc.minReal).toBeLessThan(gfc.baselineEndingReal + 1e9)
  })
})

describe('how failing runs fail', () => {
  const budget = (amount: number) => ({ mode: 'detailed' as const, items: [{ id: 'b', label: 'Budget', category: 'general', amount, frequency: 'annual' as const }] })
  const stretched = () => plan({ expenses: budget(95000) })

  function summary(overrides: Partial<FailureSummary> = {}): FailureSummary {
    return {
      failed: 10, total: 100,
      firstShortAge: { earliest: 80, median: 85, latest: 90 },
      byAge: [{ label: '80–84', runs: 4, detail: null }, { label: '85–89', runs: 5, detail: null }, { label: '90–94', runs: 1, detail: null }],
      beforeRetirement: 0, limitedByRules: 0, limitedByStrategy: 0, shortYears: 6, annualShortfall: 20000, totalShortfall: 120000, fundedShare: null,
      comparison: { savingsAtRetirement: null, earlyRealReturn: null, earlyInflation: null, earlyYears: 10 },
      ...overrides,
    }
  }

  it('accounts for every failing run, at ages inside the plan', () => {
    const p = stretched()
    const result = runMonteCarlo(p, YEAR, 60)
    const f = result.failures
    expect(f).not.toBeNull()
    expect(f!.failed).toBe(result.runs - result.successes)
    expect(f!.byAge.reduce((s, b) => s + b.runs, 0)).toBe(f!.failed)
    expect(f!.firstShortAge.earliest).toBeLessThanOrEqual(f!.firstShortAge.median)
    expect(f!.firstShortAge.median).toBeLessThanOrEqual(f!.firstShortAge.latest)
    expect(f!.firstShortAge.earliest).toBeGreaterThanOrEqual(YEAR - (YEAR - 60))
    expect(f!.annualShortfall).toBeGreaterThan(0)
    expect(f!.totalShortfall).toBeGreaterThanOrEqual(f!.annualShortfall)
    expect(f!.fundedShare).toBeGreaterThan(0)
    expect(f!.fundedShare).toBeLessThan(1)
  })

  it('describes the failing runs in each age group', () => {
    const f = runMonteCarlo(stretched(), YEAR, 60).failures!
    for (const bucket of f.byAge) {
      if (bucket.runs === 0) {
        expect(bucket.detail).toBeNull()
        continue
      }
      const d = bucket.detail!
      expect(d.shortYears).toBeGreaterThan(0)
      expect(d.annualShortfall).toBeGreaterThan(0)
      expect(d.totalShortfall).toBeGreaterThanOrEqual(d.annualShortfall)
      expect(d.moneyLeft).toBeLessThanOrEqual(bucket.runs)
    }
    expect(f.byAge.reduce((s, b) => s + (b.detail?.moneyLeft ?? 0), 0)).toBe(f.limitedByRules + f.limitedByStrategy)
  })

  it('reports nothing when no run fails', () => {
    const rich = plan({
      accounts: [{ id: 't', ownerId: 'a', type: 'TFSA', balance: 20_000_000 }],
      expenses: budget(30000),
      // A fixed 4% of this much can still run dry, spending far beyond the budget.
      drawdown: { strategy: { kind: 'expenses' } },
    })
    expect(runMonteCarlo(rich, YEAR, 40).failures).toBeNull()
    expect(runBacktest(rich, YEAR).failures).toBeNull()
  })

  it('explains the historical failures too', () => {
    const b = runBacktest(stretched(), YEAR)
    const failed = b.windows.filter(w => !w.success).length
    expect(failed).toBeGreaterThan(0)
    expect(b.failures!.failed).toBe(failed)
    expect(b.failures!.total).toBe(b.windows.length)
  })

  it('records the failure in the year the run first fell short', () => {
    const p = stretched()
    const c = compilePlan(p, { startYear: YEAR })
    const path = deterministicPath(c.years, -5, 2)
    const result = simulate(c, path)
    expect(runSucceeded(result)).toBe(false)
    const first = result.rows.find(r => r.shortfall > Math.max(100 * r.cpi, 0.01 * (r.withdrawal + r.shortfall)))!
    expect(analyzeRun(c, path, result).failure!.firstShortOffset).toBe(first.offset)
  })

  it('tells apart why a run fell short with money left', () => {
    const failureOf = (p: PlanV2, returnPct?: number) => {
      const c = compilePlan(p, { startYear: YEAR })
      const path = deterministicPath(c.years, returnPct ?? c.expectedReturnPct, c.inflationPct)
      return analyzeRun(c, path, simulate(c, path)).failure!
    }
    const funded = { strategy: { kind: 'expenses' as const } }
    // A LIF's yearly maximum caps a budget the balance could otherwise pay.
    const lif = plan({ accounts: [{ id: 'l', ownerId: 'a', type: 'LIF', balance: 2_000_000, jurisdiction: 'ON' }], expenses: budget(300000), drawdown: funded })
    expect(failureOf(lif).moneyLeft).toBe('limits')
    // 4% of these savings is far below the budget, while the money is still there.
    expect(failureOf(stretched(), -5).moneyLeft).toBe('strategy')
    // Withdrawing what the budget needs, the money really does run out.
    expect(failureOf(plan({ expenses: budget(95000), drawdown: funded }), -5).moneyLeft).toBeNull()
  })

  it('blames a too-low withdrawal rate before a funding gap', () => {
    const cause = failureCause(summary({ limitedByStrategy: 6 }), true)
    expect(cause.title).toMatch(/withdrawals are set too low/)
    expect(cause.body).toMatch(/Fund my spending/)
    expect(failureCause(summary({ limitedByStrategy: 2 }), true).title).toBe('A funding gap')
  })

  it('names a funding gap ahead of whatever the markets did', () => {
    const weak = summary({ comparison: { savingsAtRetirement: null, earlyRealReturn: { failed: 0, funded: 0.05 }, earlyInflation: null, earlyYears: 10 } })
    expect(failureCause(weak, true).body).toMatch(/funding gap/)
    expect(failureCause(weak, false).body).toMatch(/first 10 years of retirement: 0\.0%.*5\.0%/)
  })

  it('picks the cause that differs, and admits when none does', () => {
    const savings = summary({ comparison: { savingsAtRetirement: { failed: 500000, funded: 800000 }, earlyRealReturn: { failed: 0.04, funded: 0.043 }, earlyInflation: null, earlyYears: 10 } })
    expect(failureCause(savings, false).body).toMatch(/less saved/)
    const inflation = summary({ comparison: { savingsAtRetirement: null, earlyRealReturn: { failed: 0.04, funded: 0.043 }, earlyInflation: { failed: 0.04, funded: 0.02 }, earlyYears: 10 } })
    expect(failureCause(inflation, false).body).toMatch(/inflation runs high/)
    expect(failureCause(summary(), false).body).toMatch(/no single stand-out cause/)
    expect(failureCause(summary({ comparison: null }), false).body).toMatch(/every market tested/)
  })

  it('adds notes only for the patterns present', () => {
    expect(failureNotes(summary(), 'budget', 'runs')).toEqual([])
    const notes = failureNotes(summary({ fundedShare: 0.72, limitedByRules: 3, limitedByStrategy: 2, beforeRetirement: 1 }), 'budget', 'runs')
    expect(notes[0]).toMatch(/72% of your budget/)
    expect(notes[1]).toMatch(/3 of the 10 runs.*LIRA and LIF/)
    expect(notes[2]).toMatch(/2 of the 10 runs.*fixed withdrawal rate/)
    expect(notes[3]).toMatch(/1 of the 10 runs.*before retirement/)
    // Already the headline, so not repeated.
    expect(failureNotes(summary({ limitedByStrategy: 7 }), 'budget', 'runs')).toEqual([])
  })

  it('describes what the test measures in each mode', () => {
    const subject = (p: PlanV2) => shortfallSubject(compilePlan(p, { startYear: YEAR }))
    expect(subject(plan())).toBe('income target')
    expect(subject(plan({ drawdown: { strategy: { kind: 'vpw' } } }))).toBe('planned withdrawals')
    expect(subject(stretched())).toBe('budget')
    expect(subject(plan({ expenses: budget(50000), drawdown: { strategy: { kind: 'vpw' } } }))).toBe('essential spending')
  })

  it('orders fixes by whether they reach the target, then by cost', () => {
    const score = (successRate: number): PlanScore => ({ successRate, onTrack: true, funded: true, goalProgressPct: 100, lifetimeTax: 0, afterTaxEstate: 0, averageIncome: 0 })
    const make = (id: string, group: Proposal['group'], rate: number): Proposal => ({ id, group, title: id, detail: '', changes: [], score: score(rate) })
    const fixes = fixesForRisk([
      make('closest', 'tradeoff', 0.85),
      make('spend-less', 'tradeoff', 0.95),
      make('reorder', 'free', 0.91),
      make('no-help', 'free', 0.705),
      make('spare', 'spare', 0.99),
    ], 0.7)
    expect(fixes.map(p => p.id)).toEqual(['reorder', 'spend-less', 'closest'])
  })
})
