import { describe, it, expect } from 'vitest'
import { planSchema, type PlanV2, type PlanV2Input } from '@/lib/plan/schema'
import { compilePlan, simulate, simulatePlan } from '@/lib/sim'
import { mulberry32 } from '@/lib/sim/rng'
import { monteCarloPath } from '@/lib/sim/paths/monteCarlo'
import { HISTORICAL_DATA, historicalPath, overlayPath } from '@/lib/sim/paths/historical'
import { settingsFromPlan } from '@/lib/sim/risk'
import { compareStockScenarios, hasSalePlan } from '@/lib/insights/stockScenarios'

const YEAR = 2026
const flat = { startYear: YEAR, returnPct: 0, inflationPct: 0 }

type StockInput = Extract<NonNullable<PlanV2Input['accounts']>[number], { type: 'STOCK' }>
function plan(stock: Partial<StockInput>, overrides: Partial<PlanV2Input> = {}, age = 66, retirementAge = 65): PlanV2 {
  return planSchema.parse({
    schemaVersion: 2, id: 'p', asOf: '2026-01-01',
    people: [{ id: 'a', name: 'A', birthYear: YEAR - age, retirementAge, province: 'ON', cpp: { mode: 'amount', amountAt65: 0 }, oas: { yearsInCanadaAfter18: 0 } }],
    accounts: [{ id: 's', ownerId: 'a', type: 'STOCK', balance: 0, ...stock }],
    ...overrides,
    // Par exchange rate keeps the expected values in round numbers.
    assumptions: { usdCad: { rate: 1 }, ...overrides.assumptions },
  })
}
const holding = (extra: object = {}) => ({ id: 'h', symbol: 'ACME', shares: 100, priceUsd: 50, growthPct: { bear: -5, base: 10, bull: 20 }, ...extra })

describe('stock holdings', () => {
  it('converts the USD share price to CAD; the cost per share is already CAD', () => {
    const p = plan({ holdings: [holding({ costPerShare: 60 })] }, { assumptions: { usdCad: { rate: 1.4 } } }, 40, 65)
    const { compiled } = simulatePlan(p, flat)
    expect(compiled.accounts[0].initialBalance).toBeCloseTo(7000, 6)
    expect(compiled.accounts[0].initialAcb).toBeCloseTo(6000, 6)
  })

  it('derives the balance from shares × price and grows each holding at its projection', () => {
    const p = plan({ holdings: [holding()] }, { drawdown: { strategy: { kind: 'initialPct', ratePct: 0.01 } } }, 40, 65)
    const { compiled, result } = simulatePlan(p, flat)
    expect(compiled.accounts[0].initialBalance).toBe(5000)
    expect(result.rows[0].stockValue).toBeCloseTo(5500, 6)
    expect(result.rows[1].stockValue).toBeCloseTo(6050, 6)
  })

  it('uses the selected bear/base/bull case', () => {
    const value = (scenario: 'bear' | 'base' | 'bull') =>
      simulatePlan(plan({ holdings: [holding()] }, { assumptions: { stockScenario: scenario } }, 40, 65), flat).result.rows[5].stockValue
    expect(value('bear')).toBeLessThan(value('base'))
    expect(value('base')).toBeLessThan(value('bull'))
  })

  it('taxes reinvested dividends each year', () => {
    const p = plan({ holdings: [holding({ dividendYieldPct: 4, growthPct: { base: 0 } })] }, {}, 40, 65)
    const row = simulatePlan(p, flat).result.rows[0]
    expect(row.investmentIncome).toBeCloseTo(200, 6)
    // Total return = growth + dividends; value includes reinvested dividends.
    expect(row.stockValue).toBeCloseTo(5200, 6)
  })
})

describe('RSUs and ESPP', () => {
  it('vests RSUs as employment income at the projected price', () => {
    const grant = { id: 'g', shares: 2000, vestAt: { kind: 'year' as const, year: YEAR + 2 } }
    const p = plan({ holdings: [holding({ rsuGrants: [grant] })] }, {}, 40, 65)
    const rows = simulatePlan(p, flat).result.rows
    const price2 = 50 * 1.1 * 1.1
    expect(rows[0].unvestedValue).toBeCloseTo(2000 * 50, 6)
    expect(rows[2].stockCompensation).toBeCloseTo(2000 * price2, 6)
    expect(rows[2].people[0].stockCompensation).toBeCloseTo(2000 * price2, 6)
    expect(rows[2].tax).toBeGreaterThan(rows[1].tax + 20000)
    expect(rows[3].unvestedValue).toBe(0)
    // Vested shares join the holding and grow with it.
    expect(rows[2].stockValue).toBeCloseTo((100 * price2 + 2000 * price2) * 1.1, 4)
  })

  it('buys ESPP shares at a discount and taxes the benefit', () => {
    const p = plan({ holdings: [holding({ espp: { annualContribution: 8500, discountPct: 15, employerMatchPct: 0 } })] }, {}, 40, 65)
    const row = simulatePlan(p, flat).result.rows[0]
    expect(row.stockCompensation).toBeCloseTo(10000 - 8500, 6)
    expect(row.contributions).toBeCloseTo(8500, 6)
    expect(row.stockValue).toBeCloseTo((5000 + 10000) * 1.1, 6)
  })

  it('forfeits unvested shares and stops ESPP after the employee dies', () => {
    const grant = { id: 'g', shares: 100, vestAt: { kind: 'year' as const, year: YEAR + 5 } }
    const p = plan({ holdings: [holding({ rsuGrants: [grant] })] }, {
      people: [{ id: 'a', name: 'A', birthYear: YEAR - 60, retirementAge: 70, lifeExpectancy: 62, province: 'ON' }],
    })
    const rows = simulatePlan(p, flat).result.rows
    expect(rows.every(r => r.stockCompensation === 0)).toBe(true)
  })
})

describe('selling stock to fund retirement', () => {
  it('sells a fixed amount each year and realizes the gain', () => {
    const p = plan({
      holdings: [holding({ shares: 20000, costPerShare: 10, growthPct: { base: 0 } })],
      salePlan: { kind: 'fixedAmount', amount: 50000 },
    }, { drawdown: { strategy: { kind: 'initialPct', ratePct: 1 } } })
    const row = simulatePlan(p, flat).result.rows[0]
    expect(row.stockSales).toBeCloseTo(50000, 6)
    // Cost $10, price $50: 80% of each dollar sold is gain.
    expect(row.realizedGains).toBeCloseTo(40000, 6)
    // The strategy only wanted 1% (10k); the rest is reinvested after tax.
    expect(row.reinvested).toBeGreaterThan(30000)
  })

  it('stops selling at the end of the sell window', () => {
    const p = plan({
      holdings: [holding({ shares: 20000, growthPct: { base: 0 } })],
      salePlan: { kind: 'fixedAmount', amount: 50000, to: { kind: 'year', year: YEAR + 3 } },
    }, { drawdown: { strategy: { kind: 'initialPct', ratePct: 0.01 } } })
    const rows = simulatePlan(p, flat).result.rows
    expect(rows[2].stockSales).toBeCloseTo(50000, 6)
    expect(rows[3].stockSales).toBeLessThan(1000)
  })

  it('covers the spending gap from stock before other accounts', () => {
    const p = planSchema.parse({
      schemaVersion: 2, id: 'p', asOf: '2026-01-01',
      people: [{ id: 'a', name: 'A', birthYear: YEAR - 66, retirementAge: 65, province: 'ON', cpp: { mode: 'amount', amountAt65: 0 }, oas: { yearsInCanadaAfter18: 0 } }],
      accounts: [
        { id: 's', ownerId: 'a', type: 'STOCK', balance: 0, holdings: [holding({ shares: 1000, growthPct: { base: 0 } })], salePlan: { kind: 'coverGap' } },
        { id: 't', ownerId: 'a', type: 'TFSA', balance: 500000 },
      ],
      expenses: { mode: 'detailed', items: [{ id: 'e', amount: 60000 }] },
      drawdown: { strategy: { kind: 'expenses' } },
      assumptions: { usdCad: { rate: 1 } },
    })
    const rows = simulatePlan(p, flat).result.rows
    // First year: the $50k of stock is used up before the TFSA is touched.
    expect(rows[0].stockSales).toBeCloseTo(50000, 6)
    expect(rows[0].balancesEnd[0]).toBeCloseTo(0, 6)
    expect(Math.abs(rows[0].afterTaxIncome - rows[0].spending)).toBeLessThan(1)
    expect(rows[1].balancesEnd[1]).toBeLessThan(rows[0].balancesEnd[1])
  })
})

describe('stock scenarios and market paths', () => {
  it('compares each price case with and without the sell plan', () => {
    const p = plan({
      holdings: [holding({ shares: 10000, costPerShare: 20 })],
      salePlan: { kind: 'fixedAmount', amount: 40000 },
    })
    expect(hasSalePlan(p)).toBe(true)
    const rows = compareStockScenarios(p, YEAR)
    expect(rows.map(r => r.scenario)).toEqual(['bear', 'base', 'bull'])
    expect(rows[0].withPlan.stockAtEnd).toBeLessThan(rows[2].withPlan.stockAtEnd)
    expect(rows[1].withPlan.totalSales).toBeGreaterThan(rows[1].noSales.totalSales)
    expect(rows[1].noSales.totalSales).toBeGreaterThanOrEqual(0)
  })

  it('gives each holding its own Monte Carlo, historical and crash path', () => {
    const p = plan({ holdings: [holding(), holding({ id: 'h2', symbol: 'BETA' })] })
    const c = compilePlan(p, { startYear: YEAR })
    expect(c.holdingCount).toBe(2)
    const mc = monteCarloPath(c, settingsFromPlan(p), mulberry32(5))
    expect(mc.stocks).toHaveLength(2)
    expect(mc.stocks![0][3]).not.toBe(mc.stocks![1][3])
    const hist = historicalPath(c, 0, { equity: 60, bond: 40, cash: 0 })
    expect(hist.stocks![0]).toHaveLength(c.years)
    const crash = overlayPath(c, 0, 2008, 1, { equity: 60, bond: 40, cash: 0 })
    const gfc = HISTORICAL_DATA.find(y => y.year === 2008)!.equity
    expect(crash.stocks![0][0]).toBeLessThan(crash.stocks![0][1])
    expect(crash.stocks![0][0]).toBeLessThan(0.15 + gfc / 2)
    expect(simulate(c, mc).rows.length).toBe(c.years)
  })
})
