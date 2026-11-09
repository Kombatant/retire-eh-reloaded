import type { PlanV2 } from '@/lib/plan/schema'
import { compilePlan } from './compile'
import type { RunRecord } from './failures'
import {
  runBacktest,
  runCrashScenarios,
  runMonteCarloBatch,
  settingsFromPlan,
  summarizeRuns,
  type BacktestSummary,
  type CrashResult,
  type MonteCarloSummary,
} from './risk'

export interface RiskUpdate {
  backtest?: BacktestSummary
  crashes?: CrashResult[]
  monteCarlo?: MonteCarloSummary
  progress: number // 0..1
  done: boolean
}

export const RISK_BATCH = 50

// Run the full risk analysis, reporting after the fast deterministic parts
// and after every Monte Carlo batch. `shouldStop` lets a newer request cancel
// this one between batches.
export async function runRiskJob(
  plan: PlanV2,
  startYear: number,
  onUpdate: (update: RiskUpdate) => void,
  opts: { maxRuns?: number; shouldStop?: () => boolean; yieldBetweenBatches?: () => Promise<void> } = {},
): Promise<void> {
  const backtest = runBacktest(plan, startYear)
  const crashes = runCrashScenarios(plan, startYear)
  onUpdate({ backtest, crashes, progress: 0, done: false })

  const c = compilePlan(plan, { startYear })
  const settings = settingsFromPlan(plan)
  const runs = Math.min(settings.runs, opts.maxRuns ?? Infinity)
  const acc = { portfolios: [] as Float64Array[], estates: [] as number[], successes: 0, records: [] as RunRecord[] }
  for (let from = 0; from < runs; from += RISK_BATCH) {
    if (opts.shouldStop?.()) return
    runMonteCarloBatch(c, settings, settings.seed, from, Math.min(RISK_BATCH, runs - from), acc)
    const done = from + RISK_BATCH >= runs
    onUpdate({
      backtest,
      crashes,
      monteCarlo: summarizeRuns(c, acc.portfolios, acc.successes, acc.estates, acc.records),
      progress: Math.min(1, (from + RISK_BATCH) / runs),
      done,
    })
    if (!done && opts.yieldBetweenBatches) await opts.yieldBetweenBatches()
  }
}
