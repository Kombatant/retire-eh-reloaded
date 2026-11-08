import { describe, it, expect } from 'vitest'
import { planSchema, type PlanV2, type PlanV2Input } from '@/lib/plan/schema'
import { simulatePlan } from '@/lib/sim'
import { amortizeYear, monthsToRepay } from '@/lib/sim/steps/debts'
import { solveIncreasing } from '@/lib/sim/steps/solver'

const YEAR = 2026
const flat = { startYear: YEAR, returnPct: 0, inflationPct: 0 }

function plan(overrides: Partial<PlanV2Input> & Pick<PlanV2Input, 'people'>): PlanV2 {
  return planSchema.parse({ schemaVersion: 2, id: 'p', asOf: '2026-01-01', ...overrides })
}
const person = (age: number, retirementAge: number, extra: object = {}) =>
  ({ id: 'a', name: 'A', birthYear: YEAR - age, retirementAge, province: 'ON' as const, ...extra })

describe('debt amortization', () => {
  it('repays a 25-year mortgage on schedule', () => {
    // Payment for $300,000 at 5% (monthly compounding) over 300 months.
    const r = 0.05 / 12
    const payment = 300000 * r / (1 - Math.pow(1 + r, -300))
    expect(monthsToRepay(300000, 0.05, payment)).toBe(300)
    let balance = 300000
    for (let y = 0; y < 25; y++) balance = amortizeYear(balance, 0.05, payment).balance
    expect(balance).toBeLessThan(1)
  })

  it('stops payments once the debt is gone', () => {
    const step = amortizeYear(1000, 0, 400)
    expect(step.paid).toBeCloseTo(1000, 6)
    expect(step.balance).toBe(0)
  })

  it('never converges when the payment does not cover interest', () => {
    expect(monthsToRepay(100000, 0.06, 400)).toBe(Infinity)
  })
})

describe('withdrawal solver', () => {
  it('finds the root of an increasing piecewise-linear function', () => {
    const f = (w: number) => (w < 50000 ? w * 0.8 : 40000 + (w - 50000) * 0.6) - 45000
    expect(solveIncreasing(f, 0, 1e6)).toBeCloseTo(50000 + 5000 / 0.6, 0)
  })
  it('clamps to the bracket ends', () => {
    expect(solveIncreasing(w => w + 10, 0, 100)).toBe(0)
    expect(solveIncreasing(w => w - 1000, 0, 100)).toBe(100)
  })
})

describe('real estate and debts', () => {
  it('counts home equity in net worth and pays the mortgage down', () => {
    const p = plan({
      people: [person(40, 65)],
      properties: [{ id: 'home', ownerId: 'a', value: 800000 }],
      debts: [{ id: 'm', kind: 'mortgage', balance: 400000, interestRatePct: 4, monthlyPayment: 2500, propertyId: 'home' }],
    })
    const rows = simulatePlan(p, flat).result.rows
    expect(rows[0].propertyValue).toBeCloseTo(800000, 6)
    expect(rows[0].debtBalance).toBeLessThan(400000)
    expect(rows[0].netWorth).toBeCloseTo(800000 - rows[0].debtBalance, 6)
    expect(rows[0].debtPayments).toBeCloseTo(30000, 6)
    const paidOff = rows.findIndex(r => r.debtBalance === 0)
    expect(paidOff).toBeGreaterThan(10)
    expect(rows[paidOff + 1].debtPayments).toBe(0)
  })

  it('downsizes: repays the mortgage, buys the smaller home and invests the rest tax-free', () => {
    const p = plan({
      people: [person(64, 65)],
      properties: [{
        id: 'home', ownerId: 'a', value: 1000000, acb: 300000,
        sale: { at: { kind: 'age', personId: 'a', age: 66 }, sellingCostPct: 5, replacementValue: 500000 },
      }],
      debts: [{ id: 'm', kind: 'mortgage', balance: 100000, interestRatePct: 0, monthlyPayment: 0, propertyId: 'home' }],
    })
    const rows = simulatePlan(p, flat).result.rows
    const sale = rows[2]
    expect(sale.deposits).toBeCloseTo(1000000 - 50000 - 100000 - 500000, 6)
    expect(sale.realizedGains).toBe(0)
    expect(sale.propertyValue).toBeCloseTo(500000, 6)
    expect(sale.debtBalance).toBe(0)
  })

  it('taxes the gain on a property that is not the principal residence', () => {
    const p = plan({
      people: [person(64, 65)],
      properties: [{
        id: 'cottage', ownerId: 'a', value: 600000, acb: 200000, isPrincipalResidence: false,
        sale: { at: { kind: 'now' }, sellingCostPct: 0 },
      }],
    })
    const row = simulatePlan(p, flat).result.rows[0]
    expect(row.realizedGains).toBeCloseTo(400000, 6)
    expect(row.tax).toBeGreaterThan(50000)
  })
})

describe('detailed spending', () => {
  const retiree = (accountType: 'TFSA' | 'RRSP') => plan({
    people: [person(66, 65, { cpp: { mode: 'amount', amountAt65: 12000 } })],
    accounts: [{ id: 'x', ownerId: 'a', type: accountType, balance: 1000000 }],
    expenses: {
      mode: 'detailed',
      items: [
        { id: 'living', label: 'Living', amount: 50000 },
        { id: 'travel', label: 'Travel', amount: 10000, essential: false },
      ],
    },
    drawdown: { strategy: { kind: 'expenses' } },
  })

  it('withdraws exactly what after-tax spending needs (tax-free account)', () => {
    const row = simulatePlan(retiree('TFSA'), flat).result.rows[0]
    expect(row.spending).toBeCloseTo(60000, 6)
    expect(Math.abs(row.afterTaxIncome - row.spending)).toBeLessThan(1)
  })

  it('grosses up RRSP withdrawals for the tax they cause', () => {
    const row = simulatePlan(retiree('RRSP'), flat).result.rows[0]
    expect(Math.abs(row.afterTaxIncome - row.spending)).toBeLessThan(1)
    expect(row.tax).toBeGreaterThan(5000)
    expect(row.withdrawal + row.guaranteedIncome).toBeGreaterThan(row.spending + row.tax - 1)
  })

  describe('adjusting for inflation', () => {
    const withItems = (items: object[]) => {
      const base = retiree('TFSA')
      return planSchema.parse({ ...base, expenses: { ...base.expenses, items } })
    }
    const inflating = { ...flat, inflationPct: 3 }

    it('indexes expenses to inflation by default', () => {
      const rows = simulatePlan(retiree('TFSA'), inflating).result.rows
      expect(rows[1].spending).toBeCloseTo(60000 * 1.03, 6)
    })

    it('holds a non-indexed expense at its dollar amount while others rise', () => {
      const rows = simulatePlan(withItems([
        { id: 'living', amount: 50000 },
        { id: 'lease', amount: 10000, indexed: false },
      ]), inflating).result.rows
      expect(rows[0].spending).toBeCloseTo(60000, 6)
      expect(rows[10].spending).toBeCloseTo(50000 * Math.pow(1.03, 10) + 10000, 6)
    })

    it('funds the lower spending with smaller withdrawals', () => {
      const indexed = simulatePlan(withItems([{ id: 'x', amount: 60000 }]), inflating).result.rows
      const fixed = simulatePlan(withItems([{ id: 'x', amount: 60000, indexed: false }]), inflating).result.rows
      expect(fixed[10].withdrawal).toBeLessThan(indexed[10].withdrawal)
    })

    it('treats growth on a non-indexed expense as the whole yearly change', () => {
      const rows = simulatePlan(withItems([{ id: 'x', amount: 10000, indexed: false, realGrowthPct: 2 }]), inflating).result.rows
      expect(rows[1].spending).toBeCloseTo(10200, 6)
    })

    it('keeps one-time expenses in real dollars even when marked non-indexed', () => {
      const rows = simulatePlan(withItems([
        { id: 'gift', amount: 10000, frequency: 'oneTime', indexed: false, from: { kind: 'age', personId: 'a', age: 70 } },
      ]), inflating).result.rows
      const year = rows.findIndex(r => r.people[0].age === 70)
      expect(rows[year].spending).toBeCloseTo(10000 * Math.pow(1.03, year), 6)
    })
  })

  it('cuts discretionary spending in a slow-go phase', () => {
    const base = retiree('TFSA')
    const withPhase = { ...base, expenses: { ...base.expenses, phases: [{ id: 'slow', name: 'Slow-go', from: { kind: 'age' as const, personId: 'a', age: 75 }, discretionaryMultiplierPct: 50 }] } }
    const rows = simulatePlan(withPhase, flat).result.rows
    expect(rows.find(r => r.people[0].age === 74)!.spending).toBeCloseTo(60000, 6)
    expect(rows.find(r => r.people[0].age === 75)!.spending).toBeCloseTo(55000, 6)
  })

  it('includes property costs and debt payments in spending', () => {
    const p = plan({
      people: [person(66, 65)],
      accounts: [{ id: 't', ownerId: 'a', type: 'TFSA', balance: 1000000 }],
      properties: [{ id: 'home', ownerId: 'a', value: 500000, annualCosts: 8000 }],
      debts: [{ id: 'car', kind: 'loan', balance: 6000, interestRatePct: 0, monthlyPayment: 500 }],
      expenses: { mode: 'detailed', items: [{ id: 'living', amount: 30000 }] },
      drawdown: { strategy: { kind: 'expenses' } },
    })
    const rows = simulatePlan(p, flat).result.rows
    expect(rows[0].spending).toBeCloseTo(30000 + 8000 + 6000, 6)
    expect(rows[1].spending).toBeCloseTo(38000, 6)
  })

  it('saves working-year surpluses when asked and draws down deficits', () => {
    const make = (spend: number, surplusPolicy: 'save' | 'ignore') => plan({
      people: [person(40, 65)],
      accounts: [{ id: 't', ownerId: 'a', type: 'TFSA', balance: 100000 }],
      incomes: [{ id: 'job', ownerId: 'a', kind: 'employment', amount: 100000, to: { kind: 'retirement', personId: 'a' } }],
      expenses: { mode: 'detailed', surplusPolicy, items: [{ id: 'living', amount: spend }] },
    })
    const saving = simulatePlan(make(40000, 'save'), flat).result.rows[0]
    expect(saving.surplus).toBeGreaterThan(20000)
    expect(saving.deposits).toBeCloseTo(saving.surplus, 6)

    const ignoring = simulatePlan(make(40000, 'ignore'), flat).result.rows[0]
    expect(ignoring.deposits).toBe(0)

    const deficit = simulatePlan(make(110000, 'ignore'), flat).result.rows[0]
    expect(deficit.surplus).toBeLessThan(0)
    expect(deficit.withdrawal).toBeCloseTo(-deficit.surplus, 0)
    expect(deficit.balancesEnd[0]).toBeCloseTo(100000 + deficit.surplus, 0)
  })
})

describe('simple mode', () => {
  it('targets replacement % of the final salary as pre-tax income', () => {
    const p = plan({
      people: [person(60, 65)],
      accounts: [{ id: 't', ownerId: 'a', type: 'TFSA', balance: 2000000 }],
      incomes: [{ id: 'job', ownerId: 'a', kind: 'employment', amount: 100000, to: { kind: 'retirement', personId: 'a' } }],
      expenses: { mode: 'simple', replacementRate: 70 },
      drawdown: { strategy: { kind: 'expenses' } },
    })
    const { compiled, result } = simulatePlan(p, flat)
    const row = result.rows[compiled.drawdownStartOffset]
    expect(row.spending).toBeCloseTo(70000, 6)
    expect(row.withdrawal + row.guaranteedIncome).toBeCloseTo(70000, 6)
  })
})
