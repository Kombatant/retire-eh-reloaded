// Live stock quotes and exchange rates, fetched directly from the browser.
//
// The app has no server, so it can only use services that allow cross-origin
// requests. Quotes need a free API key from the user's chosen provider;
// exchange rates come from the Bank of Canada (no key). Symbols and the key
// are sent only to those services.

export type QuoteProvider = 'twelvedata' | 'alphavantage'

export const QUOTE_PROVIDERS: Record<QuoteProvider, { name: string; keyUrl: string; note: string; minIntervalMs: number }> = {
  twelvedata: {
    name: 'Twelve Data',
    keyUrl: 'https://twelvedata.com/pricing',
    note: 'Free key: 800 requests a day, 8 a minute. US and TSX symbols.',
    minIntervalMs: 8000,
  },
  alphavantage: {
    name: 'Alpha Vantage',
    keyUrl: 'https://www.alphavantage.co/support/#api-key',
    note: 'Free key: 25 requests a day.',
    minIntervalMs: 1200,
  },
}

export interface Quote {
  symbol: string
  price: number
  currency: string
  asOf: string // ISO date-time
  source: string
}

export class QuoteError extends Error {
  readonly kind: 'auth' | 'rateLimit' | 'notFound' | 'network' | 'unknown'
  constructor(kind: QuoteError['kind'], message: string) {
    super(message)
    this.kind = kind
  }
}

type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

export interface ParsedSymbol {
  base: string
  exchange: 'TSX' | 'TSXV' | 'NEO' | null // null = US or as typed
  currencyHint: 'CAD' | null
}

// Accept the common Canadian suffixes: SHOP.TO / SHOP.TSX (TSX), ABC.V (TSX
// Venture), XYZ.NE (Cboe Canada). Anything else is passed through as typed.
export function parseSymbol(input: string): ParsedSymbol {
  const symbol = input.trim().toUpperCase()
  const match = symbol.match(/^(.+?)[.:](TO|TSX|TRT|V|CN|NE|NEO)$/)
  if (!match) return { base: symbol, exchange: null, currencyHint: null }
  const suffix = match[2]
  const exchange = suffix === 'V' ? 'TSXV' : suffix === 'NE' || suffix === 'NEO' || suffix === 'CN' ? 'NEO' : 'TSX'
  return { base: match[1], exchange, currencyHint: 'CAD' }
}

function num(value: unknown): number {
  const n = typeof value === 'string' ? parseFloat(value) : typeof value === 'number' ? value : NaN
  return Number.isFinite(n) ? n : NaN
}

async function getJson(fetchImpl: FetchLike, url: string): Promise<Record<string, unknown>> {
  let response
  try {
    response = await fetchImpl(url)
  } catch {
    throw new QuoteError('network', 'Could not reach the quote service. Check your connection.')
  }
  if (response.status === 429) throw new QuoteError('rateLimit', 'Too many requests. Wait a minute and try again.')
  if (response.status === 401 || response.status === 403) throw new QuoteError('auth', 'The API key was rejected.')
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  return body
}

async function twelveData(fetchImpl: FetchLike, apiKey: string, input: string): Promise<Quote> {
  const parsed = parseSymbol(input)
  const params = new URLSearchParams({ symbol: parsed.base, apikey: apiKey })
  if (parsed.exchange) params.set('exchange', parsed.exchange)
  const body = await getJson(fetchImpl, `https://api.twelvedata.com/quote?${params}`)
  if (body.status === 'error') {
    const code = num(body.code)
    const message = String(body.message ?? 'Quote not available.')
    if (code === 401 || code === 403) throw new QuoteError('auth', message)
    if (code === 429) throw new QuoteError('rateLimit', message)
    if (code === 404 || code === 400) throw new QuoteError('notFound', `No quote for ${input}.`)
    throw new QuoteError('unknown', message)
  }
  // Prefer the latest close; `close` is the last trade during market hours.
  const price = num(body.close)
  if (!(price > 0)) throw new QuoteError('notFound', `No quote for ${input}.`)
  const timestamp = num(body.last_quote_at) || num(body.timestamp)
  return {
    symbol: input.trim().toUpperCase(),
    price,
    currency: String(body.currency ?? parsed.currencyHint ?? 'USD').toUpperCase(),
    asOf: timestamp > 0 ? new Date(timestamp * 1000).toISOString() : new Date().toISOString(),
    source: QUOTE_PROVIDERS.twelvedata.name,
  }
}

async function alphaVantage(fetchImpl: FetchLike, apiKey: string, input: string): Promise<Quote> {
  const parsed = parseSymbol(input)
  // Alpha Vantage uses .TRT for Toronto and .TRV for TSX Venture.
  const symbol = parsed.exchange === 'TSX' ? `${parsed.base}.TRT` : parsed.exchange === 'TSXV' ? `${parsed.base}.TRV` : parsed.base
  const params = new URLSearchParams({ function: 'GLOBAL_QUOTE', symbol, apikey: apiKey })
  const body = await getJson(fetchImpl, `https://www.alphavantage.co/query?${params}`)
  if (typeof body.Note === 'string' || typeof body.Information === 'string') {
    const message = String(body.Note ?? body.Information)
    throw new QuoteError(/premium|demo|invalid|api key/i.test(message) && !/frequency|per day|rate/i.test(message) ? 'auth' : 'rateLimit', message)
  }
  if (typeof body['Error Message'] === 'string') throw new QuoteError('notFound', `No quote for ${input}.`)
  const quote = (body['Global Quote'] ?? {}) as Record<string, unknown>
  const price = num(quote['05. price'])
  if (!(price > 0)) throw new QuoteError('notFound', `No quote for ${input}.`)
  const day = String(quote['07. latest trading day'] ?? '')
  return {
    symbol: input.trim().toUpperCase(),
    price,
    // GLOBAL_QUOTE does not report a currency: Canadian listings are CAD.
    currency: parsed.currencyHint ?? 'USD',
    asOf: /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day}T21:00:00.000Z` : new Date().toISOString(),
    source: QUOTE_PROVIDERS.alphavantage.name,
  }
}

export async function fetchQuote(provider: QuoteProvider, apiKey: string, symbol: string, fetchImpl: FetchLike = fetch): Promise<Quote> {
  if (!apiKey.trim()) throw new QuoteError('auth', 'Add an API key to fetch prices.')
  if (!symbol.trim()) throw new QuoteError('notFound', 'Enter a symbol first.')
  return provider === 'alphavantage'
    ? alphaVantage(fetchImpl, apiKey.trim(), symbol)
    : twelveData(fetchImpl, apiKey.trim(), symbol)
}

// Canadian dollars per unit of `currency`, from the Bank of Canada's daily
// average rate (most recent business day).
export async function fetchFxToCad(currency: string, fetchImpl: FetchLike = fetch): Promise<number> {
  const code = currency.toUpperCase()
  if (code === 'CAD') return 1
  const series = `FX${code}CAD`
  const body = await getJson(fetchImpl, `https://www.bankofcanada.ca/valet/observations/${series}/json?recent=1`)
  const observations = body.observations as Record<string, { v?: string }>[] | undefined
  const rate = num(observations?.[0]?.[series]?.v)
  if (!(rate > 0)) throw new QuoteError('notFound', `No Bank of Canada exchange rate for ${code}.`)
  return rate
}

// The latest Bank of Canada USD→CAD rate (no API key needed).
export async function fetchUsdCad(fetchImpl: FetchLike = fetch): Promise<{ rate: number; asOf?: string }> {
  const body = await getJson(fetchImpl, 'https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1')
  const observation = (body.observations as Record<string, unknown>[] | undefined)?.[0]
  const rate = num((observation?.FXUSDCAD as { v?: string } | undefined)?.v)
  if (!(rate > 0)) throw new QuoteError('notFound', 'No Bank of Canada exchange rate for USD.')
  return { rate, asOf: typeof observation?.d === 'string' ? observation.d : undefined }
}

export interface PricedQuote extends Quote {
  fxToCad: number // CAD per unit of the quote currency
  priceUsd: number
}

export interface RefreshResult {
  prices: Record<string, PricedQuote> // by symbol as typed (upper case)
  errors: Record<string, string>
  usdCad?: { rate: number; asOf?: string }
}

// Fetch every distinct symbol once and express it in US dollars: a CAD
// listing is converted through CAD at Bank of Canada rates. Requests are
// spaced to respect free-tier per-minute limits; one failure does not stop
// the rest.
export async function refreshQuotes(
  symbols: string[],
  provider: QuoteProvider,
  apiKey: string,
  opts: { fetchImpl?: FetchLike; delayMs?: number } = {},
): Promise<RefreshResult> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const delay = opts.delayMs ?? QUOTE_PROVIDERS[provider].minIntervalMs
  const unique = [...new Set(symbols.map(s => s.trim().toUpperCase()).filter(Boolean))]
  const result: RefreshResult = { prices: {}, errors: {} }
  if (unique.length === 0) return result
  try {
    result.usdCad = await fetchUsdCad(fetchImpl)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Exchange rate failed.'
    for (const symbol of unique) result.errors[symbol] = `Could not get the USD→CAD rate: ${message}`
    return result
  }
  const usdCad = result.usdCad.rate
  const fx = new Map<string, number>([['CAD', 1], ['USD', usdCad]])
  for (let i = 0; i < unique.length; i++) {
    const symbol = unique[i]
    try {
      const quote = await fetchQuote(provider, apiKey, symbol, fetchImpl)
      if (!fx.has(quote.currency)) fx.set(quote.currency, await fetchFxToCad(quote.currency, fetchImpl))
      const rate = fx.get(quote.currency)!
      result.prices[symbol] = { ...quote, fxToCad: rate, priceUsd: quote.currency === 'USD' ? quote.price : (quote.price * rate) / usdCad }
    } catch (error) {
      result.errors[symbol] = error instanceof Error ? error.message : 'Quote failed.'
      // Bad key or rate limit will fail every remaining symbol too.
      if (error instanceof QuoteError && (error.kind === 'auth' || error.kind === 'rateLimit')) {
        for (const rest of unique.slice(i + 1)) result.errors[rest] = error.message
        break
      }
    }
    if (delay > 0 && i < unique.length - 1) await new Promise(r => setTimeout(r, delay))
  }
  return result
}

// Market data settings live in this browser only: never in the plan, so the
// key is not exported in YAML or share links.
export interface MarketDataSettings {
  provider: QuoteProvider
  apiKey: string
  autoRefresh: boolean
}

const SETTINGS_KEY = 'retireEh.marketData'

export function loadMarketDataSettings(): MarketDataSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')
    return {
      provider: raw.provider === 'alphavantage' ? 'alphavantage' : 'twelvedata',
      apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
      autoRefresh: raw.autoRefresh !== false,
    }
  } catch {
    return { provider: 'twelvedata', apiKey: '', autoRefresh: true }
  }
}

export function saveMarketDataSettings(settings: MarketDataSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Storage blocked: the key simply is not remembered.
  }
}

// Prices are refreshed at most once a day: a quote fetched on an earlier
// calendar day is stale (weekend quotes keep Friday's market time).
export function isStale(fetchedAt: string | undefined, now: Date = new Date()): boolean {
  if (!fetchedAt) return true
  return fetchedAt.slice(0, 10) < now.toISOString().slice(0, 10)
}
