import { simulate } from '@/lib/sim/simulate'
import { planPath } from '@/lib/sim/paths/deterministic'
import { householdBaseAge } from '@/lib/sim/legacyAdapter'
import type { CompiledPlan, MarketPath, SimResult } from '@/lib/sim/types'

export const WITHDRAWAL_RATES = [4, 4.5, 5, 5.5, 6]

// The chart's lines are full simulations, so tax, benefits, minimums and gifts
// count; a rate's line only differs from the plan by its withdrawal rule.
function withRate(c: CompiledPlan, ratePct: number): CompiledPlan {
  return { ...c, strategy: 'initialPct', spendingStrategy: { kind: 'initialPct', ratePct }, initialWithdrawalRatePct: ratePct }
}

const totalBalance = (result: SimResult, t: number) => result.rows[t].balancesStart.reduce((s, b) => s + b, 0)

// The constant rate that ends the plan with about nothing left; 0 when no rate does.
function rateThatDepletes(c: CompiledPlan, path: MarketPath): number {
  const endBalance = (rate: number) => simulate(withRate(c, rate), path).rows.at(-1)?.balancesEnd.reduce((s, b) => s + b, 0) ?? 0
  let low = 0.01
  let high = 20
  if (endBalance(high) > 1) return 0
  for (let i = 0; i < 18; i++) {
    const middle = (low + high) / 2
    if (endBalance(middle) > 1) low = middle
    else high = middle
  }
  return high
}

export interface WithdrawalRatePoint { age: number; deplete?: number; [rate: string]: number | undefined }

export function buildWithdrawalRateSeries(c: CompiledPlan, returnPct: number, showRealValues: boolean): { data: WithdrawalRatePoint[]; depletionRate: number; endAge: number } {
  const D = c.drawdownStartOffset
  const path = planPath(c, returnPct)
  const baseAge = householdBaseAge(c)
  const endAge = baseAge + c.years - 1
  if (D >= c.years || simulate(c, path).rows[D].balancesStart.reduce((s, b) => s + b, 0) <= 0) return { data: [], depletionRate: 0, endAge }

  const scale = (result: SimResult, t: number) => totalBalance(result, t) / (showRealValues ? result.rows[t].cpi : 1)
  const runs = WITHDRAWAL_RATES.map(rate => simulate(withRate(c, rate), path))
  const depletionRate = rateThatDepletes(c, path)
  const deplete = depletionRate > 0 ? simulate(withRate(c, depletionRate), path) : null
  const data: WithdrawalRatePoint[] = []
  for (let t = D; t < c.years; t++) {
    const point: WithdrawalRatePoint = { age: baseAge + t }
    WITHDRAWAL_RATES.forEach((rate, i) => { point[`${rate}%`] = scale(runs[i], t) })
    if (deplete) point.deplete = scale(deplete, t)
    data.push(point)
  }
  return { data, depletionRate, endAge }
}
