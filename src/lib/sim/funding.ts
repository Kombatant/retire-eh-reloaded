import type { CompiledPlan, SimResult, YearRow } from './types'

// One verdict for the whole app: whether a plan is funded, and what went wrong
// if it isn't. Every page reads this, so none can disagree.

// Part of the Monte Carlo cache keys: bump whenever the engine's results change,
// so a page can't show numbers worked out by an older calculation.
export const MODEL_VERSION = 8

// A year is short by more than a dollar in today's dollars, the same size as the
// engine's own deadband. Anything larger is real money, not rounding.
const FUNDING_TOLERANCE = 1
// Balances under a dollar in today's dollars count as empty.
export const EMPTY_BALANCE = 1
// The chance of success plans should reach.
export const TARGET_SUCCESS = 0.9

export function yearFellShort(r: Pick<YearRow, 'shortfall' | 'cpi'>): boolean {
  return r.shortfall > FUNDING_TOLERANCE * r.cpi
}

// Why a year fell short while the accounts still held money: withdrawal limits
// (LIRA/LIF) or a fixed-rate strategy that took less than was needed. 'savings'
// means the money was gone.
export type ShortfallCause = 'savings' | 'limits' | 'strategy'

export function shortfallCause(c: CompiledPlan, first: YearRow, typicalShortfall: number): ShortfallCause {
  const balance = first.balancesEnd.reduce((s, b) => s + b, 0)
  if (balance / first.cpiEnd <= Math.max(EMPTY_BALANCE, typicalShortfall)) return 'savings'
  // The strategy's own withdrawal was made in full, so nothing capped it.
  const heldBack = first.phase === 'drawdown' && c.spendingStrategy.kind === 'initialPct' && first.withdrawalShortfall <= FUNDING_TOLERANCE * first.cpi
  return heldBack ? 'strategy' : 'limits'
}

export interface FundingResult {
  funded: boolean
  // Simple mode with no income target: there is nothing to measure the plan against.
  needsTarget: boolean
  firstShortfall: { offset: number; year: number; amount: number } | null // amount in today's dollars
  shortYears: number
  totalShortfall: number // today's dollars
  cause: ShortfallCause | null
  // When savings run out, reported apart from funding: a plan can use up its
  // savings and still be funded by pensions, and can be short with money left.
  depletion: { offset: number; year: number } | null
}

export function evaluateFunding(c: CompiledPlan, result: SimResult): FundingResult {
  const short = result.rows.filter(yearFellShort)
  const totalShortfall = short.reduce((s, r) => s + r.shortfall / r.cpi, 0)
  const first = short[0]
  return {
    funded: short.length === 0,
    needsTarget: c.expenseMode === 'simple' && c.simpleSpendingTarget <= 0,
    firstShortfall: first ? { offset: first.offset, year: first.year, amount: first.shortfall / first.cpi } : null,
    shortYears: short.length,
    totalShortfall,
    cause: first ? shortfallCause(c, first, totalShortfall / short.length) : null,
    depletion: result.depletionOffset === null ? null : { offset: result.depletionOffset, year: c.startYear + result.depletionOffset },
  }
}
