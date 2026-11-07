import historical from '@/data/historical/canada-annual.json'
import type { CompiledPlan, MarketPath } from '../types'

export interface HistoricalYear {
  year: number
  equity: number
  bond: number
  cash: number
  inflation: number
}

export const HISTORICAL_DATA: HistoricalYear[] = historical.data
export const HISTORICAL_SOURCE: string = historical.source
export const HISTORICAL_RANGE: string = historical.years

export interface Mix { equity: number; bond: number; cash: number } // percent

const HISTORICAL_EQUITY_MEAN = HISTORICAL_DATA.reduce((s, y) => s + y.equity, 0) / HISTORICAL_DATA.length

// Individual stocks replay the market's surprises (beta 1) around their own
// expected return, so a crash year hits them as hard as the index.
function stockSeries(c: CompiledPlan, equity: Float64Array, surprise: (t: number) => number): Float64Array[] {
  const out: Float64Array[] = []
  for (const a of c.accounts) {
    for (const h of a.stock?.holdings ?? []) {
      out[h.index] = Float64Array.from(equity, (_, t) => Math.max(-0.95, h.growth + h.dividendYield + surprise(t)))
    }
  }
  return out
}

// Replay history from `startIndex`. Plans are longer than the data, so the
// sequence wraps around to the first year (a common backtesting convention).
export function historicalPath(c: CompiledPlan, startIndex: number, mix: Mix, data: HistoricalYear[] = HISTORICAL_DATA): MarketPath {
  const years = c.years
  const n = data.length
  const total = mix.equity + mix.bond + mix.cash || 1
  const equity = new Float64Array(years)
  const bond = new Float64Array(years)
  const cash = new Float64Array(years)
  const nominalReturn = new Float64Array(years)
  const inflation = new Float64Array(years)
  for (let t = 0; t < years; t++) {
    const y = data[(startIndex + t) % n]
    equity[t] = y.equity
    bond[t] = y.bond
    cash[t] = y.cash
    inflation[t] = y.inflation
    nominalReturn[t] = (mix.equity * y.equity + mix.bond * y.bond + mix.cash * y.cash) / total
  }
  return {
    nominalReturn, inflation, assets: { equity, bond, cash },
    stocks: stockSeries(c, equity, t => equity[t] - HISTORICAL_EQUITY_MEAN),
  }
}

// Expected returns everywhere except a historical sequence replayed from
// `atOffset` (e.g. a crash in the first years of retirement).
export function overlayPath(c: CompiledPlan, atOffset: number, fromYear: number, length: number, mix: Mix): MarketPath {
  const years = c.years
  const total = mix.equity + mix.bond + mix.cash || 1
  const path: MarketPath = {
    nominalReturn: new Float64Array(years).fill(c.expectedReturnPct / 100),
    inflation: new Float64Array(years).fill(c.inflationPct / 100),
    assets: {
      equity: new Float64Array(years).fill(c.assetReturnsPct.equity / 100),
      bond: new Float64Array(years).fill(c.assetReturnsPct.bond / 100),
      cash: new Float64Array(years).fill(c.assetReturnsPct.cash / 100),
    },
  }
  const start = HISTORICAL_DATA.findIndex(y => y.year === fromYear)
  const shocked = new Float64Array(years)
  path.stocks = stockSeries(c, path.assets!.equity, t => shocked[t])
  if (start < 0) return path
  for (let i = 0; i < length; i++) {
    const t = atOffset + i
    const y = HISTORICAL_DATA[start + i]
    if (t < 0 || t >= years || !y) continue
    path.assets!.equity[t] = y.equity
    path.assets!.bond[t] = y.bond
    path.assets!.cash[t] = y.cash
    path.inflation[t] = y.inflation
    path.nominalReturn[t] = (mix.equity * y.equity + mix.bond * y.bond + mix.cash * y.cash) / total
    shocked[t] = y.equity - HISTORICAL_EQUITY_MEAN
  }
  path.stocks = stockSeries(c, path.assets!.equity, t => shocked[t])
  return path
}

export const CRASH_SCENARIOS = [
  { id: 'gfc', label: '2008 financial crisis', fromYear: 2008, length: 2, description: 'TSX −32% then +34%, replayed in your first two retirement years.' },
  { id: 'dotcom', label: '2000–2002 tech crash', fromYear: 2000, length: 3, description: 'Three weak equity years in a row at the start of retirement.' },
  { id: 'stagflation', label: '1970s stagflation', fromYear: 1973, length: 9, description: 'High inflation (up to 12.5%) and poor real returns, 1973–1981.' },
] as const
