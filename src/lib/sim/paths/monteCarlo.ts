import { normal, type Rng } from '../rng'
import type { CompiledPlan, MarketPath } from '../types'

export interface MonteCarloSettings {
  portfolioVolPct: number
  equityVolPct: number
  bondVolPct: number
  cashVolPct: number
  stochasticInflation: boolean
  inflationVolPct: number
  inflationPersistence: number
}

// Lognormal annual return with the given arithmetic mean and standard
// deviation (fractions). Lognormal keeps returns above −100% and reproduces
// the right skew of compounded returns.
export function lognormalReturn(mean: number, sd: number, z: number): number {
  if (sd <= 0) return mean
  const sigma2 = Math.log(1 + (sd * sd) / ((1 + mean) * (1 + mean)))
  const mu = Math.log(1 + mean) - sigma2 / 2
  return Math.exp(mu + Math.sqrt(sigma2) * z) - 1
}

// Long-run correlations between Canadian equities, bonds and cash, applied
// through a Cholesky factor of
//   [1, 0.2, 0], [0.2, 1, 0.3], [0, 0.3, 1].
const L21 = 0.2
const L22 = Math.sqrt(1 - 0.04)
const L32 = 0.3 / L22
const L33 = Math.sqrt(1 - L32 * L32)
// The default portfolio moves like a 60/40 equity/bond blend, rescaled to unit variance.
const BLEND_SD = Math.sqrt(0.36 + 0.16 + 2 * 0.6 * 0.4 * 0.2)

export function monteCarloPath(c: CompiledPlan, s: MonteCarloSettings, rng: Rng): MarketPath {
  const years = c.years
  const equity = new Float64Array(years)
  const bond = new Float64Array(years)
  const cash = new Float64Array(years)
  const nominalReturn = new Float64Array(years)
  const inflation = new Float64Array(years)
  const mean = c.inflationPct / 100
  const infSd = s.inflationVolPct / 100
  const phi = s.inflationPersistence
  let pi = mean

  for (let t = 0; t < years; t++) {
    const e1 = normal(rng)
    const e2 = normal(rng)
    const e3 = normal(rng)
    const zEquity = e1
    const zBond = L21 * e1 + L22 * e2
    const zCash = L32 * e2 + L33 * e3
    const zPortfolio = (0.6 * zEquity + 0.4 * zBond) / BLEND_SD
    equity[t] = lognormalReturn(c.assetReturnsPct.equity / 100, s.equityVolPct / 100, zEquity)
    bond[t] = lognormalReturn(c.assetReturnsPct.bond / 100, s.bondVolPct / 100, zBond)
    cash[t] = lognormalReturn(c.assetReturnsPct.cash / 100, s.cashVolPct / 100, zCash)
    nominalReturn[t] = lognormalReturn(c.expectedReturnPct / 100, s.portfolioVolPct / 100, zPortfolio)
    if (s.stochasticInflation) {
      // AR(1): shocks persist, so high inflation tends to last several years.
      pi = mean + phi * (pi - mean) + infSd * Math.sqrt(1 - phi * phi) * normal(rng)
      inflation[t] = pi
    } else {
      inflation[t] = mean
    }
  }
  return { nominalReturn, inflation, assets: { equity, bond, cash }, stocks: stockPaths(c, equity, s.equityVolPct / 100, rng) }
}

// Individual stocks move with the equity market (correlation 0.7) plus their
// own noise, around their expected return and volatility.
const STOCK_MARKET_CORRELATION = 0.7

function stockPaths(c: CompiledPlan, equity: Float64Array, equityVol: number, rng: Rng): Float64Array[] {
  const out: Float64Array[] = []
  const equityMean = c.assetReturnsPct.equity / 100
  for (const a of c.accounts) {
    for (const h of a.stock?.holdings ?? []) {
      const series = new Float64Array(c.years)
      for (let t = 0; t < c.years; t++) {
        // Recover the equity shock from its return so stocks share it.
        const zMarket = equityShock(equity[t], equityMean, equityVol)
        const z = STOCK_MARKET_CORRELATION * zMarket + Math.sqrt(1 - STOCK_MARKET_CORRELATION ** 2) * normal(rng)
        series[t] = lognormalReturn(h.growth + h.dividendYield, h.volatility, z)
      }
      out[h.index] = series
    }
  }
  return out
}

// Inverse of lognormalReturn: the standard-normal shock behind an equity return.
function equityShock(r: number, mean: number, sd: number): number {
  const sigma2 = Math.log(1 + (sd * sd) / ((1 + mean) * (1 + mean)))
  const mu = Math.log(1 + mean) - sigma2 / 2
  return sigma2 > 0 ? (Math.log(1 + r) - mu) / Math.sqrt(sigma2) : 0
}
