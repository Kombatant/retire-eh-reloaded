import type { PlanV2 } from '@/lib/plan/schema'
import { compilePlan } from './compile'
import { simulate } from './simulate'
import { mulberry32 } from './rng'
import { monteCarloPath, type MonteCarloSettings } from './paths/monteCarlo'
import { CRASH_SCENARIOS, HISTORICAL_DATA, historicalPath, overlayPath, retirementAnchoredPath, type Mix } from './paths/historical'
import { planPath } from './paths/deterministic'
import { analyzeRun, summarizeFailures, yearFellShort, type FailureSummary, type RunRecord } from './failures'
import { quantile } from './math'
import type { CompiledPlan, SimResult } from './types'

// A run fails when a year's `shortfall` is more than rounding. What counts as
// a shortfall depends on the spending mode and strategy; see YearRow.
export function runSucceeded(result: SimResult): boolean {
  return !result.rows.some(yearFellShort)
}

// Simple mode measures against the income target, or for flexible strategies
// the planned withdrawals; with neither, there is nothing to test.
export function successIsMeaningful(c: CompiledPlan, result: SimResult): boolean {
  if (c.expenseMode === 'detailed' || c.simpleSpendingTarget > 0) return true
  return c.spendingStrategy.kind !== 'initialPct' && c.spendingStrategy.kind !== 'expenses' && result.rows.some(r => r.withdrawal > 0 || r.shortfall > 0)
}

export function successDescription(c: CompiledPlan): string {
  if (c.expenseMode === 'simple') {
    const kind = c.spendingStrategy.kind
    if (kind === 'initialPct') return 'Share of simulated markets in which your income reaches your target every year to the end of the plan. A fixed withdrawal rate often can\u2019t, even with money left over; the \u201cFund my spending\u201d strategy draws what the target needs.'
    if (kind === 'expenses') return 'Share of simulated markets in which your income reaches your target every year to the end of the plan.'
    return 'Share of simulated markets in which your planned withdrawals could be made every year. This strategy adjusts income by design, so it isn\u2019t tested against your income target.'
  }
  const kind = c.spendingStrategy.kind
  if (kind === 'expenses' || kind === 'initialPct') return 'Share of simulated markets in which your whole budget is funded every year to the end of the plan. The whole plan, including tax and benefits, is re-run each time.'
  return 'Share of simulated markets in which your essential spending is funded every year. This withdrawal strategy adjusts other spending by design, so cuts to it do not count as failure.'
}

// End-of-year portfolio in plan-start dollars.
function realPortfolio(result: SimResult): Float64Array {
  return Float64Array.from(result.rows, r => r.balancesEnd.reduce((s, b) => s + b, 0) / r.cpiEnd)
}

export interface Band { p10: number; p25: number; p50: number; p75: number; p90: number }

export interface MonteCarloSummary {
  runs: number
  successes: number
  successRate: number
  years: number[]
  bands: Band[]
  medianEstate: number // real
  p10Estate: number // real
  // How the runs that fell short failed; null when none did or none were recorded.
  failures: FailureSummary | null
}

export function summarizeRuns(c: CompiledPlan, portfolios: Float64Array[], successes: number, estates: number[], records: RunRecord[] = []): MonteCarloSummary {
  const runs = portfolios.length
  const column = new Float64Array(runs)
  const bands: Band[] = []
  for (let t = 0; t < c.years; t++) {
    for (let i = 0; i < runs; i++) column[i] = portfolios[i][t]
    const sorted = column.slice().sort()
    bands.push({ p10: quantile(sorted, 0.1), p25: quantile(sorted, 0.25), p50: quantile(sorted, 0.5), p75: quantile(sorted, 0.75), p90: quantile(sorted, 0.9) })
  }
  const sortedEstates = estates.slice().sort((a, b) => a - b)
  return {
    runs,
    successes,
    successRate: runs > 0 ? successes / runs : 0,
    years: Array.from({ length: c.years }, (_, t) => c.startYear + t),
    bands,
    medianEstate: quantile(sortedEstates, 0.5),
    p10Estate: quantile(sortedEstates, 0.1),
    failures: summarizeFailures(c, records),
  }
}

export interface MonteCarloAccumulator {
  portfolios: Float64Array[]
  estates: number[]
  successes: number
  // Filled only when the caller wants failures explained; proposals don't.
  records?: RunRecord[]
}

// Run a batch of Monte Carlo trials. Seeds are derived per run, so results
// do not depend on batch size (the worker streams batches).
export function runMonteCarloBatch(
  c: CompiledPlan,
  settings: MonteCarloSettings,
  seed: number,
  fromRun: number,
  count: number,
  acc: MonteCarloAccumulator = { portfolios: [], estates: [], successes: 0 },
): MonteCarloAccumulator {
  for (let i = fromRun; i < fromRun + count; i++) {
    const rng = mulberry32((seed * 2654435761 + i * 40503) >>> 0)
    const path = monteCarloPath(c, settings, rng)
    const result = simulate(c, path)
    acc.records?.push(analyzeRun(c, path, result))
    acc.portfolios.push(realPortfolio(result))
    if (runSucceeded(result)) acc.successes++
    const estate = result.estate
    acc.estates.push(estate ? estate.afterTaxEstate / estate.cpi : 0)
  }
  return acc
}

export function settingsFromPlan(plan: PlanV2): MonteCarloSettings & { runs: number; seed: number; historicalMix: Mix } {
  return plan.assumptions.simulation
}

export function runMonteCarlo(plan: PlanV2, startYear: number, runs?: number): MonteCarloSummary {
  const c = compilePlan(plan, { startYear })
  const s = settingsFromPlan(plan)
  const acc = runMonteCarloBatch(c, s, s.seed, 0, runs ?? s.runs, { portfolios: [], estates: [], successes: 0, records: [] })
  return summarizeRuns(c, acc.portfolios, acc.successes, acc.estates, acc.records)
}

export interface BacktestWindow {
  startYear: number
  success: boolean
  endingReal: number
  minReal: number
  // First calendar year of the plan in which spending could not be funded.
  failureYear: number | null
}

// 95% Wilson interval for a success rate: the simulation's own sampling error,
// which is a separate question from whether the assumptions are right.
export function successRange(successes: number, runs: number): { low: number; high: number } {
  if (runs <= 0) return { low: 0, high: 0 }
  const z = 1.96
  const p = successes / runs
  const denominator = 1 + (z * z) / runs
  const centre = (p + (z * z) / (2 * runs)) / denominator
  const margin = (z * Math.sqrt((p * (1 - p)) / runs + (z * z) / (4 * runs * runs))) / denominator
  return { low: Math.max(0, centre - margin), high: Math.min(1, centre + margin) }
}

export interface BacktestSummary {
  windows: BacktestWindow[]
  successRate: number
  failures: FailureSummary | null
}

// `anchor` chooses where the history starts: from today, or from the first
// retirement year with expected returns until then.
export function runBacktest(plan: PlanV2, startYear: number, anchor: 'plan' | 'retirement' = 'plan'): BacktestSummary {
  const c = compilePlan(plan, { startYear })
  const mix = plan.assumptions.simulation.historicalMix
  const records: RunRecord[] = []
  const windows = HISTORICAL_DATA.map((h, i) => {
    const path = anchor === 'retirement' ? retirementAnchoredPath(c, i, mix) : historicalPath(c, i, mix)
    const result = simulate(c, path)
    records.push(analyzeRun(c, path, result))
    const portfolio = realPortfolio(result)
    const failed = result.rows.find(yearFellShort)
    return {
      startYear: h.year,
      success: !failed,
      endingReal: portfolio[portfolio.length - 1] ?? 0,
      minReal: portfolio.slice(c.drawdownStartOffset).reduce((m, v) => Math.min(m, v), Infinity),
      failureYear: failed ? failed.year : null,
    }
  })
  return { windows, successRate: windows.filter(w => w.success).length / Math.max(1, windows.length), failures: summarizeFailures(c, records) }
}

const LONGEVITY_YEARS = [5, 10]

export interface CrashResult {
  id: string
  label: string
  description: string
  success: boolean
  endingReal: number
  minReal: number
  baselineEndingReal: number
}

export function runCrashScenarios(plan: PlanV2, startYear: number): CrashResult[] {
  const c = compilePlan(plan, { startYear })
  const mix = plan.assumptions.simulation.historicalMix
  const baseline = realPortfolio(simulate(c, planPath(c)))
  const baselineEndingReal = baseline[baseline.length - 1] ?? 0
  const toResult = (id: string, label: string, description: string, compiled: CompiledPlan, result: SimResult): CrashResult => {
    const portfolio = realPortfolio(result)
    return {
      id, label, description,
      success: runSucceeded(result),
      endingReal: portfolio[portfolio.length - 1] ?? 0,
      minReal: portfolio.slice(compiled.drawdownStartOffset).reduce((m, v) => Math.min(m, v), Infinity),
      baselineEndingReal,
    }
  }
  const crashes = CRASH_SCENARIOS.map(s => toResult(s.id, s.label, s.description, c, simulate(c, overlayPath(c, c.drawdownStartOffset, s.fromYear, s.length, mix))))
  // Living longer, at average markets: everyone reaches their age plus this.
  const longevity = LONGEVITY_YEARS.map(extra => {
    const longer: PlanV2 = { ...plan, people: plan.people.map(p => ({ ...p, lifeExpectancy: p.lifeExpectancy + extra })) }
    const compiled = compilePlan(longer, { startYear })
    return toResult(`longevity-${extra}`, `Living ${extra} years longer`, `Everyone lives ${extra} years past the plan's life expectancy, with average markets.`, compiled, simulate(compiled, planPath(compiled)))
  })
  return [...crashes, ...longevity]
}
