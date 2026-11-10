import { moneyCompact } from '@/lib/formatting'
import type { FailureSummary } from '@/lib/sim/failures'
import type { CompiledPlan } from '@/lib/sim/types'
import { MIN_SUCCESS_GAIN, TARGET_SUCCESS, type Proposal } from './proposals'

// Smaller gaps between failing and funded runs are noise, not a cause.
const RETURN_GAP = 0.01
const INFLATION_GAP = 0.005
const SAVINGS_GAP = 0.1
const MAX_FIXES = 5

export const pct1 = (rate: number) => `${(rate * 100).toFixed(1)}%`

// What "short" is measured against; it differs by spending mode and strategy.
export function shortfallSubject(c: CompiledPlan): string {
  const kind = c.spendingStrategy.kind
  if (c.expenseMode === 'simple') return kind === 'initialPct' || kind === 'expenses' ? 'income target' : 'planned withdrawals'
  return kind === 'expenses' || kind === 'initialPct' ? 'budget' : 'essential spending'
}

export interface FailureCause {
  title: string
  body: string
  // The plan needs changing whatever markets do.
  severe: boolean
}

// The main reason. A strategy that withdraws too little comes first, because
// it can also make a plan fail at its expected returns; after that, a plan
// that fails at its own expected returns has a funding gap, whatever the
// failing markets looked like.
export function failureCause(s: FailureSummary, averageMarketsFail: boolean): FailureCause {
  const markets = (body: string): FailureCause => ({ title: 'What goes wrong', body, severe: false })
  if (s.limitedByStrategy * 2 >= s.failed) {
    return {
      title: 'Your withdrawals are set too low',
      body: 'Your fixed withdrawal rate takes less each year than your spending or income target needs, so years fall short while money is still in your accounts. The “Fund my spending” strategy under Withdrawals draws what is needed instead.',
      severe: true,
    }
  }
  if (averageMarketsFail) {
    return {
      title: 'A funding gap',
      body: 'Your plan runs short even when markets deliver your expected returns every year. This is a funding gap rather than bad luck: planned spending is more than your savings and income can support.',
      severe: true,
    }
  }
  const compare = s.comparison
  if (!compare) {
    return markets('Your plan works at your expected returns, but fell short in every market tested, so it has very little margin for ordinary ups and downs.')
  }
  const returns = compare.earlyRealReturn
  if (returns && returns.funded - returns.failed >= RETURN_GAP) {
    return markets(`Your plan works at your expected returns. It fails when markets are weak in the first ${compare.earlyYears} years of retirement: ${pct1(returns.failed)} a year after inflation in the runs that fell short, against ${pct1(returns.funded)} in the funded ones. Withdrawing while markets are down leaves less to recover with.`)
  }
  const savings = compare.savingsAtRetirement
  if (savings && savings.funded > 0 && (savings.funded - savings.failed) / savings.funded >= SAVINGS_GAP) {
    return markets(`Your plan works at your expected returns. It fails when weak markets before retirement leave you with less saved: about ${moneyCompact(savings.failed)} at retirement in the runs that fell short, against ${moneyCompact(savings.funded)} in the funded ones.`)
  }
  const inflation = compare.earlyInflation
  if (inflation && inflation.failed - inflation.funded >= INFLATION_GAP) {
    return markets(`Your plan works at your expected returns. It fails when inflation runs high early in retirement: ${pct1(inflation.failed)} a year in the runs that fell short, against ${pct1(inflation.funded)} in the funded ones.`)
  }
  return markets('Your plan works at your expected returns. The runs that fell short had no single stand-out cause, so the margin is thin across many kinds of market.')
}

// The patterns a reader wouldn't guess from the headline numbers.
export function failureNotes(s: FailureSummary, subject: string, unit: string): string[] {
  const notes: string[] = []
  const count = (n: number) => `${n} of the ${s.failed} ${unit}`
  if (s.fundedShare !== null) {
    notes.push(`In the years that fall short, about ${Math.round(s.fundedShare * 100)}% of your ${subject} is still paid, from income such as CPP, OAS and pensions and what is left in savings.`)
  }
  if (s.limitedByRules > 0) {
    notes.push(`In ${count(s.limitedByRules)}, money was still in your accounts but could not be used that year, because LIRA and LIF rules limit withdrawals. Holding more outside locked-in accounts would help these.`)
  }
  // When it is most of the failures, the headline has already said this.
  if (s.limitedByStrategy > 0 && s.limitedByStrategy * 2 < s.failed) {
    notes.push(`In ${count(s.limitedByStrategy)}, your fixed withdrawal rate took less than your spending or income target needed while money was still in your accounts.`)
  }
  if (s.beforeRetirement > 0) {
    notes.push(`In ${count(s.beforeRetirement)}, the first shortfall comes before retirement, while spending is more than earnings and available savings.`)
  }
  return notes
}

// The tested changes that actually move the chance of success, most useful
// first: those that reach the target (costless ones ahead of trade-offs), then
// whichever get closest.
export function fixesForRisk(proposals: Proposal[], baseRate: number): Proposal[] {
  const rate = (p: Proposal) => p.score.successRate ?? 0
  const reaches = (p: Proposal) => rate(p) >= TARGET_SUCCESS
  const cost = { free: 0, combo: 1, tradeoff: 2, spare: 3 }
  return proposals
    .filter(p => p.group !== 'spare' && rate(p) >= baseRate + MIN_SUCCESS_GAIN)
    .sort((a, b) => {
      if (reaches(a) !== reaches(b)) return reaches(a) ? -1 : 1
      if (reaches(a) && cost[a.group] !== cost[b.group]) return cost[a.group] - cost[b.group]
      return rate(b) - rate(a)
    })
    .slice(0, MAX_FIXES)
}
