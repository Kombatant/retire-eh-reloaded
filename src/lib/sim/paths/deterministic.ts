import type { MarketPath } from '../types'

// Constant-return, constant-inflation scenario (the deterministic projection).
export function deterministicPath(years: number, nominalReturnPct: number, inflationPct: number): MarketPath {
  return {
    nominalReturn: new Float64Array(years).fill(nominalReturnPct / 100),
    inflation: new Float64Array(years).fill(inflationPct / 100),
  }
}
