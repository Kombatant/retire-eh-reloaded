import { householdBaseAge } from './legacyAdapter'
import { quantile, sum } from './math'
import { accountReturnAt } from './simulate'
import { shortfallCause, yearFellShort } from './funding'
import type { CompiledPlan, MarketPath, SimResult, YearRow } from './types'

// Sequence risk is decided mostly in the first decade of retirement, so that
// is the stretch whose markets get compared.
export const EARLY_RETIREMENT_YEARS = 10
const AGE_BUCKET_YEARS = 5

export { yearFellShort } from './funding'

export interface RunFailure {
  firstShortOffset: number
  shortYears: number
  // Today's dollars, averaged over the short years.
  annualShortfall: number
  totalShortfall: number
  // Share of the budget still paid in the short years. Null when the plan's
  // test isn't the whole budget.
  fundedShare: number | null
  // Why a year fell short while the accounts still held money: withdrawal
  // limits (LIRA/LIF), or a fixed-rate strategy that took less than the budget
  // needed. Null when the savings were gone.
  moneyLeft: 'limits' | 'strategy' | null
}

// What is kept from one run: small enough to hold one per run for a whole job.
export interface RunRecord {
  failure: RunFailure | null
  // Today's dollars; null for a plan that is already drawing down.
  savingsAtRetirement: number | null
  earlyRealReturn: number | null
  earlyInflation: number | null
}

function yearReturn(c: CompiledPlan, account: number, path: MarketPath, t: number): number {
  const a = c.accounts[account]
  const holdings = a.stock?.holdings ?? []
  const total = holdings.reduce((s, h) => s + h.shares * h.price, 0)
  if (total <= 0) return accountReturnAt(c, a, path, t)
  return holdings.reduce((s, h) => s + (h.shares * h.price / total) * (path.stocks?.[h.index]?.[t] ?? h.growth + h.dividendYield), 0)
}

// Returns over the early retirement years, holding the mix at retirement fixed.
// Weighting by each year's balance instead would make a depleted run look like
// it had no market at all.
function earlyMarkets(c: CompiledPlan, path: MarketPath, rows: YearRow[]): { realReturn: number | null; inflation: number } | null {
  const from = c.drawdownStartOffset
  const to = Math.min(from + EARLY_RETIREMENT_YEARS, c.years)
  if (to <= from || !rows[from]) return null
  const weights = rows[from].balancesStart
  const total = sum(weights)
  let growth = 1
  let prices = 1
  for (let t = from; t < to; t++) {
    prices *= rows[t].cpiEnd / rows[t].cpi
    if (total > 0) growth *= 1 + weights.reduce((s, w, a) => s + (w / total) * yearReturn(c, a, path, t), 0)
  }
  const n = to - from
  return {
    realReturn: total > 0 ? Math.pow(growth / prices, 1 / n) - 1 : null,
    inflation: Math.pow(prices, 1 / n) - 1,
  }
}

function describeFailure(c: CompiledPlan, rows: YearRow[]): RunFailure | null {
  const short = rows.filter(yearFellShort)
  if (short.length === 0) return null
  const first = short[0]
  const total = short.reduce((s, r) => s + r.shortfall / r.cpi, 0)
  const kind = c.spendingStrategy.kind
  const wholeBudget = c.expenseMode === 'detailed' && (kind === 'expenses' || kind === 'initialPct')
  const withBudget = short.filter(r => r.spending > 0)
  const annual = total / short.length
  const cause = shortfallCause(c, first, annual)
  return {
    firstShortOffset: first.offset,
    shortYears: short.length,
    annualShortfall: annual,
    totalShortfall: total,
    fundedShare: wholeBudget && withBudget.length > 0
      ? withBudget.reduce((s, r) => s + r.fundedSpending / r.spending, 0) / withBudget.length
      : null,
    moneyLeft: cause === 'savings' ? null : cause,
  }
}

export function analyzeRun(c: CompiledPlan, path: MarketPath, result: SimResult): RunRecord {
  const start = result.rows[c.drawdownStartOffset]
  const markets = earlyMarkets(c, path, result.rows)
  return {
    failure: describeFailure(c, result.rows),
    savingsAtRetirement: start && c.drawdownStartOffset > 0 ? sum(start.balancesStart) / start.cpi : null,
    earlyRealReturn: markets?.realReturn ?? null,
    earlyInflation: markets?.inflation ?? null,
  }
}

export interface MedianComparison { failed: number; funded: number }

// Middle values across a group of failing runs.
export interface FailureGroupDetail {
  shortYears: number
  annualShortfall: number
  totalShortfall: number
  fundedShare: number | null
  earlyRealReturn: number | null
  savingsAtRetirement: number | null
  // Runs in the group whose accounts still held money in the first short year.
  moneyLeft: number
}

export interface AgeBucket {
  label: string
  runs: number
  // Null for an empty bucket.
  detail: FailureGroupDetail | null
}

export interface FailureSummary {
  failed: number
  total: number
  // Age of the youngest person in the first short year.
  firstShortAge: { earliest: number; median: number; latest: number }
  // Failing runs by age at first shortfall, with empty buckets kept so the
  // axis stays even.
  byAge: AgeBucket[]
  beforeRetirement: number
  // Failing runs whose first short year still had money in the accounts.
  limitedByRules: number
  limitedByStrategy: number
  // Medians across the failing runs.
  shortYears: number
  annualShortfall: number
  totalShortfall: number
  fundedShare: number | null
  // Null when every run failed: there is nothing to compare against.
  comparison: {
    savingsAtRetirement: MedianComparison | null
    earlyRealReturn: MedianComparison | null
    earlyInflation: MedianComparison | null
    earlyYears: number
  } | null
}

function median(values: number[]): number {
  return quantile(values.slice().sort((a, b) => a - b), 0.5)
}

function medianOfPresent(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null)
  return present.length > 0 ? median(present) : null
}

function groupDetail(runs: RunRecord[]): FailureGroupDetail | null {
  const failures = runs.flatMap(r => (r.failure ? [r.failure] : []))
  if (failures.length === 0) return null
  return {
    shortYears: Math.round(median(failures.map(f => f.shortYears))),
    annualShortfall: median(failures.map(f => f.annualShortfall)),
    totalShortfall: median(failures.map(f => f.totalShortfall)),
    fundedShare: medianOfPresent(failures.map(f => f.fundedShare)),
    earlyRealReturn: medianOfPresent(runs.map(r => r.earlyRealReturn)),
    savingsAtRetirement: medianOfPresent(runs.map(r => r.savingsAtRetirement)),
    moneyLeft: failures.filter(f => f.moneyLeft !== null).length,
  }
}

function compareMedians(failed: RunRecord[], funded: RunRecord[], pick: (r: RunRecord) => number | null): MedianComparison | null {
  const present = (runs: RunRecord[]) => runs.map(pick).filter((v): v is number => v !== null)
  const a = present(failed)
  const b = present(funded)
  return a.length > 0 && b.length > 0 ? { failed: median(a), funded: median(b) } : null
}

export function summarizeFailures(c: CompiledPlan, records: RunRecord[]): FailureSummary | null {
  const failedRuns = records.filter(r => r.failure)
  const failures = failedRuns.map(r => r.failure as RunFailure)
  if (failures.length === 0) return null
  const fundedRuns = records.filter(r => !r.failure)
  const baseAge = householdBaseAge(c)
  const ages = failures.map(f => baseAge + f.firstShortOffset)
  const earliest = Math.min(...ages)
  const latest = Math.max(...ages)

  const bucketOf = (age: number) => Math.floor(age / AGE_BUCKET_YEARS) * AGE_BUCKET_YEARS
  const byAge: FailureSummary['byAge'] = []
  for (let start = bucketOf(earliest); start <= bucketOf(latest); start += AGE_BUCKET_YEARS) {
    const runs = failedRuns.filter((_, i) => bucketOf(ages[i]) === start)
    byAge.push({ label: `${start}–${start + AGE_BUCKET_YEARS - 1}`, runs: runs.length, detail: groupDetail(runs) })
  }

  const overall = groupDetail(failedRuns) as FailureGroupDetail
  return {
    failed: failures.length,
    total: records.length,
    firstShortAge: { earliest, median: Math.round(median(ages)), latest },
    byAge,
    beforeRetirement: failures.filter(f => f.firstShortOffset < c.drawdownStartOffset).length,
    limitedByRules: failures.filter(f => f.moneyLeft === 'limits').length,
    limitedByStrategy: failures.filter(f => f.moneyLeft === 'strategy').length,
    shortYears: overall.shortYears,
    annualShortfall: overall.annualShortfall,
    totalShortfall: overall.totalShortfall,
    fundedShare: overall.fundedShare,
    comparison: fundedRuns.length === 0 ? null : {
      savingsAtRetirement: compareMedians(failedRuns, fundedRuns, r => r.savingsAtRetirement),
      earlyRealReturn: compareMedians(failedRuns, fundedRuns, r => r.earlyRealReturn),
      earlyInflation: compareMedians(failedRuns, fundedRuns, r => r.earlyInflation),
      earlyYears: Math.min(EARLY_RETIREMENT_YEARS, c.years - c.drawdownStartOffset),
    },
  }
}
