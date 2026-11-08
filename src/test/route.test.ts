import { describe, it, expect } from 'vitest'
import { DEFAULT_ROUTE, formatRoute, parseRoute, sameRoute } from '@/lib/ui/route'

describe('hash routes', () => {
  it('parses pages and sub-views', () => {
    expect(parseRoute('#/dashboard')).toEqual({ view: 'dashboard' })
    expect(parseRoute('#/projections/drawdown')).toEqual({ view: 'projections', sub: 'drawdown' })
    expect(parseRoute('#/plan/savings')).toEqual({ view: 'plan', sub: 'savings' })
  })

  it('falls back to the default page for an empty, unknown or share hash', () => {
    expect(parseRoute('')).toEqual(DEFAULT_ROUTE)
    expect(parseRoute('#')).toEqual(DEFAULT_ROUTE)
    expect(parseRoute('#/nowhere')).toEqual(DEFAULT_ROUTE)
    // Share links put the encoded plan in the hash; that is not a route.
    expect(parseRoute('#plan=eJyrVkrLz1eyUkpKLFKqBQAdegQ0')).toEqual(DEFAULT_ROUTE)
  })

  it('sends an unknown plan section to the first section', () => {
    expect(parseRoute('#/plan/bogus')).toEqual({ view: 'plan', sub: 'household' })
    expect(parseRoute('#/plan')).toEqual({ view: 'plan', sub: 'household' })
  })

  it('round-trips through formatRoute', () => {
    for (const route of [{ view: 'risk' as const }, { view: 'cashflow' as const, sub: 'table' }, DEFAULT_ROUTE]) {
      expect(parseRoute(formatRoute(route))).toEqual(route)
    }
  })

  it('compares routes', () => {
    expect(sameRoute({ view: 'risk' }, { view: 'risk' })).toBe(true)
    expect(sameRoute({ view: 'risk' }, { view: 'risk', sub: 'historical' })).toBe(false)
  })
})
