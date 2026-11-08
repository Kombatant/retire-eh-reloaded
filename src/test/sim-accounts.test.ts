import { describe, it, expect } from 'vitest'
import { planSchema, type PlanV2, type PlanV2Input } from '@/lib/plan/schema'
import { simulatePlan } from '@/lib/sim'

const YEAR = 2026

function plan(overrides: Partial<PlanV2Input> & Pick<PlanV2Input, 'people'>): PlanV2 {
  return planSchema.parse({ schemaVersion: 2, id: 'p', asOf: '2026-01-01', ...overrides })
}

const person = (age: number, retirementAge: number, extra: object = {}) =>
  ({ id: 'a', name: 'A', birthYear: YEAR - age, retirementAge, province: 'ON' as const, ...extra })

// Zero return and inflation make cash flows easy to check by hand.
const flat = { startYear: YEAR, returnPct: 0, inflationPct: 0 }

describe('non-registered accounts', () => {
  it('realizes capital gains in proportion to the unrealized gain', () => {
    const p = plan({
      people: [person(66, 65)],
      accounts: [{ id: 'n', ownerId: 'a', type: 'NONREG', balance: 100000, acb: 60000 }],
      assumptions: { expectedReturn: 0 },
    })
    const { result } = simulatePlan(p, flat)
    // 4% of 100k withdrawn; 40% of it is gain.
    expect(result.rows[0].withdrawal).toBeCloseTo(4000, 6)
    expect(result.rows[0].realizedGains).toBeCloseTo(1600, 6)
    // The cost base falls by 2,400, so the gain share stays 40% next year.
    expect(result.rows[1].realizedGains).toBeCloseTo(1600, 6)
  })

  it('taxes annual distributions even when they are reinvested', () => {
    const make = (interestPct: number) => plan({
      people: [person(66, 65)],
      accounts: [{ id: 'n', ownerId: 'a', type: 'NONREG', balance: 500000, yields: { interestPct } }],
      assumptions: { expectedReturn: 0 },
    })
    const withYield = simulatePlan(make(3), flat).result.rows[0]
    const noYield = simulatePlan(make(0), flat).result.rows[0]
    expect(withYield.investmentIncome).toBeCloseTo(15000, 6)
    expect(withYield.tax).toBeGreaterThan(noYield.tax + 1000)
    // Reinvested distributions raise the cost base, so less of each sale is gain.
    expect(withYield.realizedGains).toBeLessThan(noYield.realizedGains + 1e-9)
  })

  it('taxes cash account interest every year', () => {
    const p = plan({
      people: [person(40, 65)],
      accounts: [{ id: 'c', ownerId: 'a', type: 'CASH', balance: 100000 }],
      incomes: [{ id: 'job', ownerId: 'a', kind: 'employment', amount: 80000, to: { kind: 'retirement', personId: 'a' } }],
      assumptions: { assetReturns: { cashPct: 3 }, expectedReturn: 7 },
    })
    const { result } = simulatePlan(p, { startYear: YEAR, inflationPct: 0 })
    expect(result.rows[0].investmentIncome).toBeCloseTo(3000, 0)
    expect(result.rows[0].realizedGains).toBe(0)
  })
})

describe('FHSA', () => {
  it('caps contributions at $8,000 a year and $40,000 lifetime, and deducts them', () => {
    const p = plan({
      people: [person(30, 65)],
      accounts: [{ id: 'f', ownerId: 'a', type: 'FHSA', balance: 0, contributions: [{ amount: 10000 }] }],
      incomes: [{ id: 'job', ownerId: 'a', kind: 'employment', amount: 90000, to: { kind: 'retirement', personId: 'a' } }],
      assumptions: { reinvestRrspRefund: true },
    })
    const { result } = simulatePlan(p, flat)
    expect(result.rows.slice(0, 5).map(r => r.contributions)).toEqual(
      expect.arrayContaining([expect.any(Number)]),
    )
    const fhsaContributions = result.rows.map(r => r.contributions - r.rrspRefunds)
    expect(fhsaContributions.slice(0, 5).every(c => Math.abs(c - 8000) < 1e-6)).toBe(true)
    expect(fhsaContributions[5]).toBe(0)
    expect(result.rows[0].rrspRefunds).toBeGreaterThan(2000)
  })
})

describe('contribution room', () => {
  it('carries TFSA room forward and flags over-contributions', () => {
    const p = plan({
      people: [person(40, 65, { room: { tfsa: 10000, rrsp: 0 } })],
      accounts: [
        { id: 't', ownerId: 'a', type: 'TFSA', balance: 0, contributions: [{ amount: 9000 }] },
        { id: 'r', ownerId: 'a', type: 'RRSP', balance: 0, contributions: [{ amount: 10000 }] },
      ],
      incomes: [{ id: 'job', ownerId: 'a', kind: 'employment', amount: 100000, to: { kind: 'retirement', personId: 'a' } }],
    })
    const rows = simulatePlan(p, flat).result.rows
    expect(rows[0].people[0].tfsaRoom).toBeCloseTo(1000, 6)
    expect(rows[1].people[0].tfsaRoom).toBeCloseTo(1000 + 7000 - 9000, 6)
    // RRSP room: none at the start, then 18% of last year's $100k each year.
    expect(rows[0].people[0].rrspRoom).toBeCloseTo(-10000, 6)
    expect(rows[1].people[0].rrspRoom).toBeCloseTo(-10000 + 18000 - 10000, 6)
  })

  it('does not track room unless a starting amount is given', () => {
    const p = plan({ people: [person(40, 65)] })
    expect(Number.isNaN(simulatePlan(p, flat).result.rows[0].people[0].tfsaRoom)).toBe(true)
  })
})

describe('income streams', () => {
  it('pays a DB bridge benefit until the bridge end age', () => {
    const p = plan({
      people: [person(58, 60)],
      incomes: [{
        id: 'db', ownerId: 'a', kind: 'dbPension', amount: 30000,
        from: { kind: 'retirement', personId: 'a' },
        db: { indexationPctOfCpi: 100, bridge: { amount: 10000, untilAge: 65 } },
      }],
    })
    const rows = simulatePlan(p, flat).result.rows
    const at = (age: number) => rows.find(r => r.people[0].age === age)!.people[0].pension
    expect(at(59)).toBe(0)
    expect(at(62)).toBeCloseTo(40000, 6)
    expect(at(65)).toBeCloseTo(30000, 6)
  })

  it('indexes a DB pension to only part of inflation once in payment', () => {
    const p = plan({
      people: [person(65, 65)],
      incomes: [{ id: 'db', ownerId: 'a', kind: 'dbPension', amount: 20000, db: { indexationPctOfCpi: 50 } }],
    })
    const rows = simulatePlan(p, { startYear: YEAR, returnPct: 0, inflationPct: 2 }).result.rows
    expect(rows[1].people[0].pension).toBeCloseTo(20000 * 1.01, 6)
    // In real terms it loses ground against inflation.
    expect(rows[10].people[0].pension / rows[10].cpi).toBeLessThan(20000)
  })

  it('grows salary at inflation plus a real raise', () => {
    const p = plan({
      people: [person(40, 65)],
      incomes: [{ id: 'job', ownerId: 'a', kind: 'employment', amount: 100000, growth: { kind: 'cpi', pct: 1 }, to: { kind: 'retirement', personId: 'a' } }],
    })
    const rows = simulatePlan(p, { startYear: YEAR, returnPct: 0, inflationPct: 2 }).result.rows
    expect(rows[1].people[0].employment).toBeCloseTo(100000 * 1.01 * 1.02, 6)
  })

  it('invests one-time windfalls instead of counting them as spending money', () => {
    const p = plan({
      people: [person(40, 65)],
      incomes: [{ id: 'inh', ownerId: 'a', kind: 'windfall', amount: 100000, frequency: 'oneTime', from: { kind: 'year', year: YEAR + 5 }, taxTreatment: 'nonTaxable' }],
    })
    const rows = simulatePlan(p, flat).result.rows
    expect(rows[5].deposits).toBeCloseTo(100000, 6)
    expect(rows[5].balancesEnd.reduce((s, b) => s + b, 0)).toBeCloseTo(100000, 6)
    expect(rows[5].otherIncome).toBeCloseTo(0, 6)
  })

  it('supports part-time work after retirement', () => {
    const p = plan({
      people: [person(60, 62)],
      incomes: [
        { id: 'job', ownerId: 'a', kind: 'employment', amount: 100000, to: { kind: 'retirement', personId: 'a' } },
        { id: 'pt', ownerId: 'a', kind: 'employment', amount: 30000, from: { kind: 'retirement', personId: 'a' }, to: { kind: 'retirement', personId: 'a', offset: 3 } },
      ],
    })
    const rows = simulatePlan(p, flat).result.rows
    expect(rows.map(r => r.people[0].employment).slice(0, 6)).toEqual([100000, 100000, 30000, 30000, 30000, 0])
  })
})

describe('per-account returns', () => {
  it('uses an override or an allocation instead of the plan default', () => {
    const p = plan({
      people: [person(40, 65)],
      accounts: [
        { id: 'default', ownerId: 'a', type: 'TFSA', balance: 100000 },
        { id: 'override', ownerId: 'a', type: 'TFSA', balance: 100000, returnOverridePct: 3 },
        { id: 'alloc', ownerId: 'a', type: 'TFSA', balance: 100000, allocation: { equity: 0, bond: 100, cash: 0 } },
      ],
      assumptions: { expectedReturn: 7, assetReturns: { bondPct: 4 } },
    })
    const row = simulatePlan(p, { startYear: YEAR, inflationPct: 0 }).result.rows[0]
    // With no contributions, a year's growth is exactly that year's annual return.
    expect(row.balancesEnd[0]).toBeCloseTo(107000, 4)
    expect(row.balancesEnd[1]).toBeCloseTo(103000, 4)
    expect(row.balancesEnd[2]).toBeCloseTo(104000, 4)
  })
})
