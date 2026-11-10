import type { CompiledPlan, MarketPath } from '../types'

// A rate that applies for only part of a year compounds to this over the part.
const forPeriod = (rate: number, fraction: number) => (fraction >= 1 ? rate : Math.pow(1 + rate, fraction) - 1)

// Shorten year 0 of a path to the part of the year left. Deterministic and
// historical paths do this directly; a Monte Carlo draw has its own convention,
// scaling drift and volatility.
export function scaleFirstPeriod(path: MarketPath, fraction: number): MarketPath {
  if (fraction >= 1) return path
  const scale = (series: Float64Array) => { series[0] = forPeriod(series[0], fraction) }
  scale(path.nominalReturn)
  scale(path.inflation)
  if (path.assets) {
    scale(path.assets.equity)
    scale(path.assets.bond)
    scale(path.assets.cash)
  }
  path.stocks?.forEach(series => { if (series) scale(series) })
  return path
}

// Constant-return, constant-inflation scenario (the deterministic projection).
export function deterministicPath(years: number, nominalReturnPct: number, inflationPct: number, firstPeriod = 1): MarketPath {
  return scaleFirstPeriod({
    nominalReturn: new Float64Array(years).fill(nominalReturnPct / 100),
    inflation: new Float64Array(years).fill(inflationPct / 100),
  }, firstPeriod)
}

// A plan's own deterministic scenario, with its first period taken into account.
export function planPath(c: CompiledPlan, nominalReturnPct = c.expectedReturnPct, inflationPct = c.inflationPct): MarketPath {
  return deterministicPath(c.years, nominalReturnPct, inflationPct, c.firstPeriodFraction)
}

// The same scenario with every individual stock's return moved by `shiftPct`,
// so a "conservative" or "optimistic" case moves stocks along with everything else.
export function shiftedDeterministicPath(c: CompiledPlan, nominalReturnPct: number, inflationPct: number, shiftPct: number): MarketPath {
  const stocks: Float64Array[] = []
  for (const a of c.accounts) {
    for (const h of a.stock?.holdings ?? []) {
      stocks[h.index] = new Float64Array(c.years).fill(h.growth + h.dividendYield + shiftPct / 100)
    }
  }
  return scaleFirstPeriod({
    nominalReturn: new Float64Array(c.years).fill(nominalReturnPct / 100),
    inflation: new Float64Array(c.years).fill(inflationPct / 100),
    stocks,
  }, c.firstPeriodFraction)
}
