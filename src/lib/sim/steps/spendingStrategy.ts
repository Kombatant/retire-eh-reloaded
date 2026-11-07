import type { SpendingStrategy } from '@/lib/plan/schema'

// Portfolio withdrawal rules for the drawdown years. Amounts are in
// plan-start (real) dollars so inflation adjustments are implicit.
export interface StrategyState {
  initialWithdrawal: number // first-year withdrawal, real
  initialRate: number // fraction
  lastWithdrawal: number // real
  lastReturn: number // nominal return of the previous year
  lastInflation: number
}

export interface StrategyContext {
  portfolio: number // real, start of year
  yearsRemaining: number // including this year
  expectedRealReturn: number // fraction, for VPW
  firstYear: boolean
}

export function strategyWithdrawal(
  strategy: SpendingStrategy,
  state: StrategyState,
  ctx: StrategyContext,
): number {
  switch (strategy.kind) {
    case 'expenses':
      return 0 // handled by the spending solver
    case 'initialPct':
      return state.initialWithdrawal
    case 'pctPortfolio': {
      // A fixed share of the current portfolio, optionally kept between a
      // floor and ceiling relative to the first year's withdrawal.
      let w = ctx.portfolio * (strategy.ratePct / 100)
      if (!ctx.firstYear) {
        if (strategy.floorPct !== undefined) w = Math.max(w, state.initialWithdrawal * strategy.floorPct / 100)
        if (strategy.ceilingPct !== undefined) w = Math.min(w, state.initialWithdrawal * strategy.ceilingPct / 100)
      }
      return w
    }
    case 'guytonKlinger': {
      if (ctx.firstYear) return state.initialWithdrawal
      let w = state.lastWithdrawal
      const rate = ctx.portfolio > 0 ? w / ctx.portfolio : Infinity
      // Inflation rule: no inflation raise after a losing year when the rate
      // is above the initial rate. Amounts are real, so skipping the raise
      // means last year's nominal amount, i.e. a real cut by inflation.
      if (state.lastReturn < 0 && rate > state.initialRate) w /= 1 + state.lastInflation
      const guard = strategy.guardrailPct / 100
      const adjust = strategy.adjustmentPct / 100
      // Capital preservation: cut when the rate drifts too high (not in the
      // last 15 years, per the original rules).
      if (rate > state.initialRate * (1 + guard) && ctx.yearsRemaining > 15) w *= 1 - adjust
      // Prosperity: raise when the rate drifts too low.
      else if (rate < state.initialRate * (1 - guard)) w *= 1 + adjust
      return w
    }
    case 'vpw': {
      // Variable percentage withdrawal: the level payment that would spend
      // the portfolio over the remaining years at the expected real return.
      const n = Math.max(1, ctx.yearsRemaining)
      const r = ctx.expectedRealReturn
      if (Math.abs(r) < 1e-9) return ctx.portfolio / n
      return ctx.portfolio * r / (1 - Math.pow(1 + r, -n)) / (1 + r)
    }
  }
}
