import { describe, it, expect } from 'vitest'
import { planSchema, type PlanV2, type PlanV2Input } from '@/lib/plan/schema'
import { simulate, simulatePlan } from '@/lib/sim'
import { lifMaximumFactor, rrifMinimumFactor } from '@/lib/sim/steps/rrif'
import { probateFee } from '@/lib/tax/probate'

const YEAR = 2026
const flat = { startYear: YEAR, returnPct: 0, inflationPct: 0 }

function plan(overrides: Partial<PlanV2Input> & Pick<PlanV2Input, 'people'>): PlanV2 {
  return planSchema.parse({ schemaVersion: 2, id: 'p', asOf: '2026-01-01', ...overrides })
}
const person = (id: string, age: number, retirementAge: number, extra: object = {}) =>
  ({ id, name: id, birthYear: YEAR - age, retirementAge, province: 'ON' as const, ...extra })
const total = (balances: number[]) => balances.reduce((s, b) => s + b, 0)

describe('RRIF and LIF rules', () => {
  it('uses the prescribed RRIF minimum factors', () => {
    expect(rrifMinimumFactor(65)).toBeCloseTo(1 / 25, 10)
    expect(rrifMinimumFactor(71)).toBeCloseTo(0.0528, 10)
    expect(rrifMinimumFactor(80)).toBeCloseTo(0.0682, 10)
    expect(rrifMinimumFactor(97)).toBeCloseTo(0.2, 10)
  })

  it('caps LIF withdrawals and allows everything at 90', () => {
    expect(lifMaximumFactor(65)).toBeGreaterThan(0.07)
    expect(lifMaximumFactor(65)).toBeLessThan(0.09)
    expect(lifMaximumFactor(90)).toBe(1)
  })

  it('forces the RRIF minimum after conversion and reinvests the excess', () => {
    const p = plan({
      people: [person('a', 72, 65)],
      accounts: [
        { id: 'r', ownerId: 'a', type: 'RRSP', balance: 500000 },
        { id: 't', ownerId: 'a', type: 'TFSA', balance: 0 },
      ],
      drawdown: { strategy: { kind: 'initialPct', ratePct: 1 } },
    })
    const row = simulatePlan(p, flat).result.rows[0]
    // Age 71 on January 1 → 5.28%.
    expect(row.withdrawal).toBeCloseTo(500000 * 0.0528, 2)
    expect(row.people[0].minimumWithdrawals).toBeCloseTo(26400, 2)
    expect(row.reinvested).toBeGreaterThan(10000)
    expect(row.balancesEnd[1]).toBeCloseTo(row.reinvested, 6)
  })

  it('can base the minimum on the younger spouse’s age', () => {
    const make = (useYounger: boolean) => plan({
      people: [person('a', 75, 65), person('b', 66, 65)],
      accounts: [{ id: 'r', ownerId: 'a', type: 'RRIF', balance: 500000 }],
      drawdown: { strategy: { kind: 'initialPct', ratePct: 1 }, rrifUseYoungerSpouseAge: useYounger },
    })
    const own = simulatePlan(make(false), flat).result.rows[0].people[0].minimumWithdrawals
    const younger = simulatePlan(make(true), flat).result.rows[0].people[0].minimumWithdrawals
    expect(younger).toBeLessThan(own)
    expect(younger).toBeCloseTo(500000 / (90 - 65), 2)
  })

  it('keeps a LIRA locked before 55 and caps LIF withdrawals', () => {
    const locked = plan({
      people: [person('a', 50, 50)],
      accounts: [
        { id: 'l', ownerId: 'a', type: 'LIRA', balance: 200000 },
        { id: 't', ownerId: 'a', type: 'TFSA', balance: 200000 },
      ],
    })
    const row = simulatePlan(locked, flat).result.rows[0]
    expect(row.balancesEnd[0]).toBe(200000)
    expect(row.withdrawal).toBeCloseTo(16000, 6)

    const lif = plan({
      people: [person('a', 60, 60)],
      accounts: [{ id: 'l', ownerId: 'a', type: 'LIF', balance: 100000 }],
      drawdown: { strategy: { kind: 'initialPct', ratePct: 20 } },
    })
    const lifRow = simulatePlan(lif, flat).result.rows[0]
    expect(lifRow.withdrawal).toBeCloseTo(100000 * lifMaximumFactor(59), 4)
    expect(lifRow.shortfall).toBeGreaterThan(0)
  })
})

describe('withdrawal order and meltdown', () => {
  it('follows a custom order, leaving the TFSA for last', () => {
    const p = plan({
      people: [person('a', 66, 65)],
      accounts: [
        { id: 'r', ownerId: 'a', type: 'RRSP', balance: 300000 },
        { id: 't', ownerId: 'a', type: 'TFSA', balance: 300000 },
      ],
      drawdown: { order: 'custom', customOrder: ['NONREG', 'RRSP', 'RRIF', 'TFSA'] },
    })
    const row = simulatePlan(p, flat).result.rows[0]
    expect(row.taxableWithdrawal).toBeCloseTo(24000, 6)
    expect(row.taxFreeWithdrawal).toBe(0)
  })

  it('melts down the RRSP up to the target taxable income and reinvests the rest', () => {
    const p = plan({
      people: [person('a', 60, 60, { cpp: { mode: 'amount', amountAt65: 0 } })],
      accounts: [
        { id: 'r', ownerId: 'a', type: 'RRSP', balance: 800000 },
        { id: 't', ownerId: 'a', type: 'TFSA', balance: 400000 },
      ],
      drawdown: { meltdown: { enabled: true, targetTaxableIncome: 60000 } },
    })
    const row = simulatePlan(p, flat).result.rows[0]
    expect(row.people[0].taxableIncome).toBeCloseTo(60000, 0)
    expect(row.meltdownWithdrawals).toBeGreaterThan(20000)
    expect(row.reinvested).toBeGreaterThan(10000)
  })
})

describe('spending strategies', () => {
  const retiree = (strategy: NonNullable<NonNullable<PlanV2Input['drawdown']>['strategy']>, extra: Partial<PlanV2Input> = {}) => plan({
    people: [person('a', 65, 65, { cpp: { mode: 'amount', amountAt65: 0 }, oas: { yearsInCanadaAfter18: 0 } })],
    accounts: [{ id: 't', ownerId: 'a', type: 'TFSA', balance: 1000000 }],
    drawdown: { strategy },
    ...extra,
  })

  it('withdraws a fixed percentage of the current portfolio', () => {
    const rows = simulatePlan(retiree({ kind: 'pctPortfolio', ratePct: 5 }), flat).result.rows
    expect(rows[0].withdrawal).toBeCloseTo(50000, 6)
    expect(rows[1].withdrawal).toBeCloseTo(47500, 6)
  })

  it('applies Guyton-Klinger guardrails after a market drop', () => {
    const p = retiree({ kind: 'guytonKlinger', initialRatePct: 5, guardrailPct: 20, adjustmentPct: 10 })
    const { compiled } = simulatePlan(p, flat)
    const path = {
      nominalReturn: new Float64Array(compiled.years).fill(0).map((_, t) => (t === 0 ? -0.4 : 0)),
      inflation: new Float64Array(compiled.years),
    }
    const rows = simulate(compiled, path).rows
    expect(rows[0].withdrawal).toBeCloseTo(50000, 6)
    // Portfolio fell to 570k; 50k is 8.8% > 6% guardrail → 10% cut.
    expect(rows[1].withdrawal).toBeCloseTo(45000, 6)
  })

  it('spends the portfolio down over the plan with VPW', () => {
    const rows = simulatePlan(retiree({ kind: 'vpw' }, { assumptions: { expectedReturn: 0, inflationRate: 0 } }), flat).result.rows
    const yearsLeft = rows.length
    expect(rows[0].withdrawal).toBeCloseTo(1000000 / yearsLeft, 4)
    expect(total(rows.at(-1)!.balancesEnd)).toBeLessThan(1)
  })

  it('never cuts below essential spending in a detailed budget', () => {
    const p = retiree({ kind: 'pctPortfolio', ratePct: 1 }, {
      expenses: { mode: 'detailed', items: [{ id: 'e', amount: 40000, essential: true }] },
    })
    const row = simulatePlan(p, flat).result.rows[0]
    expect(row.afterTaxIncome).toBeGreaterThanOrEqual(40000 - 1)
  })
})

describe('first death and estate', () => {
  const couple = plan({
    people: [
      person('a', 78, 65, { lifeExpectancy: 80, cpp: { mode: 'amount', amountAt65: 15000 } }),
      person('b', 76, 65, { lifeExpectancy: 90, cpp: { mode: 'amount', amountAt65: 5000 } }),
    ],
    accounts: [
      { id: 'ra', ownerId: 'a', type: 'RRIF', balance: 400000 },
      { id: 'tb', ownerId: 'b', type: 'TFSA', balance: 100000 },
    ],
    incomes: [{ id: 'db', ownerId: 'a', kind: 'dbPension', amount: 30000, db: { survivorPct: 60 } }],
  })

  it('continues survivor pensions and rolls accounts to the spouse', () => {
    const rows = simulatePlan(couple, flat).result.rows
    const before = rows[2] // a is 80
    const after = rows[3] // a has died
    expect(before.people[0].alive).toBe(true)
    expect(after.people[0].alive).toBe(false)
    expect(after.people[0].pension).toBe(0)
    expect(after.people[1].pension).toBeCloseTo(18000, 6)
    // CPP survivor's pension: 60% of 15,000, capped at the maximum.
    expect(after.people[1].cpp).toBeCloseTo(5000 + 9000, 6)
    // The RRIF is now taxed to the survivor.
    expect(after.people[1].registeredWithdrawals).toBeGreaterThan(0)
    expect(after.people[0].tax).toBe(0)
  })

  it('taxes the registered balance on the final return and adds probate', () => {
    const { result } = simulatePlan(couple, flat)
    const estate = result.estate!
    const last = result.rows.at(-1)!
    expect(estate.year).toBe(last.year)
    expect(estate.grossEstate).toBeCloseTo(last.netWorth, 6)
    expect(estate.finalReturnTax).toBeGreaterThan(0)
    expect(estate.probate).toBeCloseTo(probateFee('ON', estate.grossEstate - estate.finalReturnTax), 6)
    expect(estate.afterTaxEstate).toBeCloseTo(estate.grossEstate - estate.finalReturnTax - estate.probate, 6)
  })

  it('leaves a TFSA-only estate untaxed', () => {
    const p = plan({
      people: [person('a', 85, 65, { lifeExpectancy: 86 })],
      accounts: [{ id: 't', ownerId: 'a', type: 'TFSA', balance: 300000 }],
    })
    const estate = simulatePlan(p, flat).result.estate!
    expect(estate.finalReturnTax).toBe(0)
  })

  it('computes Ontario probate on the estate value', () => {
    expect(probateFee('ON', 50000)).toBe(0)
    expect(probateFee('ON', 550000)).toBeCloseTo(7500, 6)
    expect(probateFee('QC', 1000000)).toBe(0)
  })
})
