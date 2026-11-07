import { describe, it, expect } from 'vitest'
import { fetchFxToCad, fetchQuote, isStale, parseSymbol, refreshQuotes, QuoteError } from '@/lib/market/quotes'
import { addAccount, addHolding, applyQuotes, newHolding, patchHolding } from '@/lib/plan/edits'
import { createDefaultPlan } from '@/lib/plan/defaults'
import { planSchema } from '@/lib/plan/schema'

type Responder = (url: string) => { status?: number; body: unknown }

function mockFetch(responder: Responder) {
  const calls: string[] = []
  const fetchImpl = async (url: string) => {
    calls.push(url)
    const { status = 200, body } = responder(url)
    return { ok: status < 400, status, json: async () => body }
  }
  return { fetchImpl, calls }
}

const boc = (rate: string) => ({ observations: [{ d: '2026-11-06', FXUSDCAD: { v: rate } }] })

describe('symbols', () => {
  it('maps Canadian suffixes to exchanges', () => {
    expect(parseSymbol('shop.to')).toEqual({ base: 'SHOP', exchange: 'TSX', currencyHint: 'CAD' })
    expect(parseSymbol('ABC.V')).toEqual({ base: 'ABC', exchange: 'TSXV', currencyHint: 'CAD' })
    expect(parseSymbol('XYZ.NE').exchange).toBe('NEO')
    expect(parseSymbol('AAPL')).toEqual({ base: 'AAPL', exchange: null, currencyHint: null })
    expect(parseSymbol('BRK.B').exchange).toBeNull()
  })
})

describe('quote providers', () => {
  it('reads a Twelve Data quote and passes the TSX exchange', async () => {
    const { fetchImpl, calls } = mockFetch(() => ({ body: { symbol: 'SHOP', currency: 'CAD', close: '150.25', last_quote_at: 1793998740 } }))
    const quote = await fetchQuote('twelvedata', 'key123', 'SHOP.TO', fetchImpl)
    expect(quote).toMatchObject({ symbol: 'SHOP.TO', price: 150.25, currency: 'CAD', source: 'Twelve Data' })
    expect(calls[0]).toContain('symbol=SHOP')
    expect(calls[0]).toContain('exchange=TSX')
    expect(calls[0]).toContain('apikey=key123')
  })

  it('reads an Alpha Vantage quote and uses its Toronto suffix', async () => {
    const { fetchImpl, calls } = mockFetch(() => ({ body: { 'Global Quote': { '05. price': '98.10', '07. latest trading day': '2026-11-06' } } }))
    const quote = await fetchQuote('alphavantage', 'k', 'RY.TO', fetchImpl)
    expect(quote).toMatchObject({ price: 98.1, currency: 'CAD' })
    expect(calls[0]).toContain('symbol=RY.TRT')
  })

  it('reports bad keys, rate limits and unknown symbols clearly', async () => {
    const auth = mockFetch(() => ({ body: { status: 'error', code: 401, message: 'Invalid API key' } }))
    await expect(fetchQuote('twelvedata', 'bad', 'AAPL', auth.fetchImpl)).rejects.toMatchObject({ kind: 'auth' })
    const limit = mockFetch(() => ({ status: 429, body: {} }))
    await expect(fetchQuote('twelvedata', 'k', 'AAPL', limit.fetchImpl)).rejects.toMatchObject({ kind: 'rateLimit' })
    const missing = mockFetch(() => ({ body: { status: 'error', code: 404, message: 'not found' } }))
    await expect(fetchQuote('twelvedata', 'k', 'NOPE', missing.fetchImpl)).rejects.toMatchObject({ kind: 'notFound' })
    await expect(fetchQuote('twelvedata', '', 'AAPL', missing.fetchImpl)).rejects.toBeInstanceOf(QuoteError)
    const offline = { fetchImpl: async () => { throw new TypeError('Failed to fetch') } }
    await expect(fetchQuote('twelvedata', 'k', 'AAPL', offline.fetchImpl)).rejects.toMatchObject({ kind: 'network' })
  })

  it('converts to CAD with the Bank of Canada rate', async () => {
    const { fetchImpl, calls } = mockFetch(() => ({ body: boc('1.4113') }))
    expect(await fetchFxToCad('USD', fetchImpl)).toBeCloseTo(1.4113, 10)
    expect(calls[0]).toContain('FXUSDCAD')
    expect(await fetchFxToCad('CAD', fetchImpl)).toBe(1)
  })
})

describe('refreshing a portfolio', () => {
  it('fetches each symbol once, converts USD prices and keeps going after a bad symbol', async () => {
    const { fetchImpl, calls } = mockFetch(url => {
      if (url.includes('bankofcanada')) return { body: boc('1.40') }
      if (url.includes('symbol=AAPL')) return { body: { currency: 'USD', close: '200' } }
      if (url.includes('symbol=SHOP')) return { body: { currency: 'CAD', close: '150' } }
      return { body: { status: 'error', code: 404, message: 'x' } }
    })
    const result = await refreshQuotes(['AAPL', 'aapl', 'SHOP.TO', 'ZZZZ'], 'twelvedata', 'k', { fetchImpl, delayMs: 0 })
    expect(result.prices.AAPL).toMatchObject({ price: 200, currency: 'USD', fxToCad: 1.4, priceCad: 280 })
    expect(result.prices['SHOP.TO'].priceCad).toBe(150)
    expect(result.errors.ZZZZ).toBeDefined()
    expect(calls.filter(u => u.includes('symbol=AAPL'))).toHaveLength(1)
    expect(calls.filter(u => u.includes('bankofcanada'))).toHaveLength(1)
  })

  it('stops early when the key is rejected', async () => {
    const { fetchImpl, calls } = mockFetch(() => ({ body: { status: 'error', code: 401, message: 'Invalid API key' } }))
    const result = await refreshQuotes(['A', 'B', 'C'], 'twelvedata', 'bad', { fetchImpl, delayMs: 0 })
    expect(calls).toHaveLength(1)
    expect(Object.keys(result.errors)).toEqual(['A', 'B', 'C'])
  })

  it('applies quotes to every matching holding and keeps the balance in sync', () => {
    let plan = createDefaultPlan(new Date('2026-06-01'))
    plan = addAccount(plan, plan.people[0].id, 'STOCK', 'stk')
    plan = addHolding(plan, 'stk', { ...newHolding('h1'), symbol: 'AAPL', shares: 10, price: 100 })
    expect(plan.accounts.find(a => a.id === 'stk')!.balance).toBe(1000)
    plan = applyQuotes(plan, { AAPL: { price: 200, currency: 'USD', fxToCad: 1.4, priceCad: 280, asOf: '2026-11-06T21:00:00Z', source: 'Twelve Data' } }, '2026-11-07T10:00:00Z')
    const account = plan.accounts.find(a => a.id === 'stk')!
    expect(account.type === 'STOCK' && account.holdings[0].price).toBe(280)
    expect(account.balance).toBe(2800)
    expect(account.type === 'STOCK' && account.holdings[0].lastQuote?.currency).toBe('USD')
    // The plan (with its quote) still validates and round-trips.
    expect(planSchema.safeParse(JSON.parse(JSON.stringify(plan))).success).toBe(true)
  })

  it('records vested and unvested shares on the same holding', () => {
    let plan = createDefaultPlan(new Date('2026-06-01'))
    plan = addAccount(plan, plan.people[0].id, 'STOCK', 'stk')
    plan = addHolding(plan, 'stk', { ...newHolding('h1'), symbol: 'ACME', shares: 300 })
    plan = patchHolding(plan, 'stk', 'h1', { rsuGrants: [{ id: 'g', shares: 200, vestAt: { kind: 'year', year: 2027 } }] })
    const account = plan.accounts.find(a => a.id === 'stk')!
    // Only vested shares count in the balance.
    expect(account.balance).toBe(300 * 50)
    expect(account.type === 'STOCK' && account.holdings[0].rsuGrants[0].shares).toBe(200)
  })

  it('treats quotes fetched before today as stale', () => {
    const now = new Date('2026-11-07T12:00:00Z')
    expect(isStale(undefined, now)).toBe(true)
    expect(isStale('2026-11-06T23:00:00Z', now)).toBe(true)
    expect(isStale('2026-11-07T08:00:00Z', now)).toBe(false)
  })
})
