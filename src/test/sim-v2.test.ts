import { describe, it, expect } from 'vitest'
import { planSchema, type PlanV2, type PlanV2Input, type ProvinceCode } from '@/lib/plan/schema'
import { createDefaultPlan } from '@/lib/plan/defaults'
import { simulatePlan } from '@/lib/sim'
import { computeIncomeTax, emptyIncome } from '@/lib/tax/personal'
import { TAX_2026 } from '@/lib/tax/data/2026'

const YEAR = 2026

function plan(overrides: Partial<PlanV2Input> & Pick<PlanV2Input, 'people'>): PlanV2 {
  return planSchema.parse({ schemaVersion: 2, id: 'p', asOf: '2026-01-01', ...overrides })
}

function person(id: string, age: number, retirementAge: number, province: ProvinceCode = 'ON', extra: object = {}) {
  return { id, name: id, birthYear: YEAR - age, retirementAge, province, ...extra }
}

describe('unified engine with v2 rules', () => {
  it('defaults new plans to Ontario', () => {
    expect(createDefaultPlan(new Date('2026-03-01')).people[0].province).toBe('ON')
  })

  it('computes the RRSP refund with the tax engine', () => {
    const p = plan({
      people: [person('a', 40, 65)],
      accounts: [
        { id: 'r', ownerId: 'a', type: 'RRSP', balance: 0, contributions: [{ amount: 10000 }] },
        { id: 't', ownerId: 'a', type: 'TFSA', balance: 0 },
      ],
      incomes: [{ id: 'job', ownerId: 'a', kind: 'employment', amount: 100000, to: { kind: 'retirement', personId: 'a' } }],
      assumptions: { reinvestRrspRefund: true },
    })
    const { result } = simulatePlan(p, { startYear: YEAR })
    const first = result.rows[0]
    const expected = computeIncomeTax({ ...emptyIncome('ON', 40), employment: 100000 }).total -
      computeIncomeTax({ ...emptyIncome('ON', 40), employment: 100000, rrspDeduction: 10000 }).total
    expect(first.rrspRefunds).toBeCloseTo(expected, 2)
    // Roughly the 29.65% combined marginal rate between $90k and $100k in Ontario.
    expect(expected).toBeGreaterThan(2800)
    expect(expected).toBeLessThan(3100)
    expect(first.balancesEnd[1]).toBeGreaterThan(expected)
  })

  it('taxes registered withdrawals to the account owner', () => {
    const p = plan({
      people: [person('a', 64, 65), person('b', 64, 65)],
      accounts: [{ id: 'r', ownerId: 'a', type: 'RRSP', balance: 1000000 }],
      drawdown: { pensionSplitting: false },
    })
    const { compiled, result } = simulatePlan(p, { startYear: YEAR })
    const row = result.rows[compiled.drawdownStartOffset]
    expect(row.people[0].registeredWithdrawals).toBeGreaterThan(0)
    expect(row.people[1].registeredWithdrawals).toBe(0)
    expect(row.people[0].tax).toBeGreaterThan(row.people[1].tax)
  })

  it('lowers household tax with pension income splitting', () => {
    const base = {
      people: [person('a', 64, 65), person('b', 64, 65)],
      accounts: [{ id: 'r', ownerId: 'a', type: 'RRSP' as const, balance: 1500000 }],
      incomes: [{ id: 'db', ownerId: 'a', kind: 'dbPension' as const, amount: 60000, from: { kind: 'retirement' as const, personId: 'a' } }],
    }
    const split = simulatePlan(plan({ ...base, drawdown: { pensionSplitting: true } }), { startYear: YEAR })
    const noSplit = simulatePlan(plan({ ...base, drawdown: { pensionSplitting: false } }), { startYear: YEAR })
    const D = split.compiled.drawdownStartOffset
    expect(split.result.rows[D].tax).toBeLessThan(noSplit.result.rows[D].tax - 2000)
    expect(split.result.rows[D].people[1].pensionSplit).toBeGreaterThan(0)
  })

  it('pays GIS to a low-income senior', () => {
    const p = plan({
      people: [person('a', 66, 65, 'ON', { cpp: { mode: 'amount', amountAt65: 6000 } })],
      accounts: [{ id: 't', ownerId: 'a', type: 'TFSA', balance: 20000 }],
    })
    const { result } = simulatePlan(p, { startYear: YEAR })
    const row = result.rows[0]
    expect(row.phase).toBe('drawdown')
    expect(row.gis).toBeGreaterThan(5000)
    expect(row.gis).toBeLessThan(TAX_2026.gis.single.maxAnnual)
    expect(row.guaranteedIncome).toBeCloseTo(row.people[0].cpp + row.people[0].oas + row.gis, 6)
  })

  it('increases OAS by 10% at 75 and prorates by residency', () => {
    const p = plan({
      people: [person('a', 74, 65, 'ON', { oas: { startAge: 65, yearsInCanadaAfter18: 30 } })],
      accounts: [{ id: 't', ownerId: 'a', type: 'TFSA', balance: 500000 }],
    })
    const { result } = simulatePlan(p, { startYear: YEAR, inflationPct: 0 })
    expect(result.rows[0].people[0].oas).toBeCloseTo(9024 * 0.75, 2)
    expect(result.rows[1].people[0].oas).toBeCloseTo(9024 * 0.75 * 1.1, 2)
  })

  it('applies the person’s province', () => {
    const make = (province: ProvinceCode) => plan({
      people: [person('a', 64, 65, province)],
      accounts: [{ id: 'r', ownerId: 'a', type: 'RRSP', balance: 2000000 }],
    })
    const tax = (province: ProvinceCode) => {
      const { compiled, result } = simulatePlan(make(province), { startYear: YEAR })
      return result.rows[compiled.drawdownStartOffset].tax
    }
    expect(tax('AB')).toBeLessThan(tax('QC'))
    expect(tax('ON')).toBeLessThan(tax('NS'))
  })

  it('runs the plan to each person’s life expectancy', () => {
    const p = plan({ people: [person('a', 60, 65, 'ON', { lifeExpectancy: 90 })] })
    const { result } = simulatePlan(p, { startYear: YEAR })
    expect(result.rows.at(-1)!.people[0].age).toBe(90)
  })
})
