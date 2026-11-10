import { beforeEach, describe, expect, it, vi } from 'vitest'
import { planSchema, type PlanV2 } from '@/lib/plan/schema'

const release: (() => void)[] = []
vi.mock('@/lib/market/quotes', async (original) => ({
  ...(await original<typeof import('@/lib/market/quotes')>()),
  refreshQuotes: vi.fn(() => new Promise(resolve => { release.push(() => resolve({ prices: {}, errors: {} })) })),
}))

const { runRefresh } = await import('@/hooks/useStockQuotes')
const { refreshQuotes } = await import('@/lib/market/quotes')

const stockPlan = (id: string, symbol: string): PlanV2 => planSchema.parse({
  schemaVersion: 2, id, asOf: '2026-01-01',
  people: [{ id: 'a', name: 'A', birthYear: 1980, retirementAge: 65 }],
  accounts: [{ id: 's', ownerId: 'a', type: 'STOCK', balance: 0, holdings: [{ id: 'h', symbol, shares: 1, priceUsd: 1 }] }],
})
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('quote refresh queue', () => {
  beforeEach(() => { vi.mocked(refreshQuotes).mockClear() })

  it('runs a plan that asks during another plan\'s refresh, once it finishes', async () => {
    const update = vi.fn()
    void runRefresh(stockPlan('one', 'AAA'), update)
    await flush()
    void runRefresh(stockPlan('two', 'BBB'), update)
    await flush()
    expect(refreshQuotes).toHaveBeenCalledTimes(1)
    release.shift()!()
    await flush()
    expect(refreshQuotes).toHaveBeenCalledTimes(2)
    expect(vi.mocked(refreshQuotes).mock.calls[1][0]).toEqual(['BBB'])
    release.shift()!()
    await flush()
  })

  it('clears the busy state after a failure, so the next one runs', async () => {
    vi.mocked(refreshQuotes).mockRejectedValueOnce(new Error('network'))
    await runRefresh(stockPlan('three', 'CCC'), vi.fn())
    void runRefresh(stockPlan('four', 'DDD'), vi.fn())
    await flush()
    expect(vi.mocked(refreshQuotes).mock.calls.at(-1)![0]).toEqual(['DDD'])
    release.shift()!()
    await flush()
  })
})
