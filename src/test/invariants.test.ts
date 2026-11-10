import { describe, expect, it } from 'vitest'
import { planSchema, type PlanV2, type PlanV2Input } from '@/lib/plan/schema'
import { compilePlan, deterministicPath, simulate } from '@/lib/sim'
import type { YearRow } from '@/lib/sim'

// Money can't appear or vanish: the same accounting identities hold for every
// row of every plan, whatever the markets do. `growth` is reported by the engine
// from what it applied, so the balance identity is not a tautology.
const YEAR = 2026
const sum = (v: number[]) => v.reduce((s, x) => s + x, 0)

function checkBalances(row: YearRow, label: string) {
  const inflow = sum(row.balancesStart) + row.contributions + row.deposits + row.stockCompensation + row.growth
  const outflow = row.withdrawal + row.stockTaxWithheld + row.homePurchaseWithdrawals
  expect(sum(row.balancesEnd), `${label}: balances in ${row.year}`).toBeCloseTo(inflow - outflow, 1)
}

function checkCash(row: YearRow, label: string) {
  const earned = row.people.reduce((s, p) => s + p.employment + p.pension + p.cpp + p.oas + p.gis - p.payroll, 0)
  const cashIn = earned + row.otherIncome + row.withdrawal + row.stockTaxWithheld
  const cashOut = row.tax + row.spending + row.contributions + row.saved + row.reinvested + row.refundsReinvested + row.oneTimeExpenses + row.saleCostsPaid
  expect(cashIn + row.budgetShortfall - cashOut, `${label}: cash in ${row.year}`).toBeCloseTo(0, -0.6)
}

const a = (age: number, retirementAge: number, extra: object = {}) => ({
  id: 'a', name: 'A', birthYear: YEAR - age, retirementAge, province: 'ON' as const,
  cpp: { mode: 'amount' as const, amountAt65: 12000 }, ...extra,
})
const b = (age: number, retirementAge: number, extra: object = {}) => ({ ...a(age, retirementAge, extra), id: 'b', name: 'B' })
const salary = (ownerId: string, amount: number, retiresAt = ownerId) => ({ id: `s-${ownerId}`, ownerId, kind: 'employment' as const, amount, to: { kind: 'retirement' as const, personId: retiresAt } })
const rrsp = (id: string, ownerId: string, balance: number, contribution = 0) => ({ id, ownerId, type: 'RRSP' as const, balance, contributions: contribution ? [{ amount: contribution, indexed: true }] : [] })
const tfsa = (id: string, ownerId: string, balance: number, contribution = 0) => ({ id, ownerId, type: 'TFSA' as const, balance, contributions: contribution ? [{ amount: contribution }] : [] })
const nonreg = (id: string, ownerId: string, balance: number, acb: number) => ({ id, ownerId, type: 'NONREG' as const, balance, acb })
const rrif = (id: string, ownerId: string, balance: number) => ({ id, ownerId, type: 'RRIF' as const, balance })

const budget = (essential: number, other = 0) => ({
  mode: 'detailed' as const, surplusPolicy: 'save' as const,
  items: [{ id: 'need', amount: essential }, { id: 'want', amount: other, essential: false }],
})
const strategies: PlanV2Input['drawdown'][] = [
  { strategy: { kind: 'expenses' } },
  { strategy: { kind: 'initialPct', ratePct: 4 } },
  { strategy: { kind: 'pctPortfolio', ratePct: 5 } },
]

type Case = Omit<PlanV2Input, 'schemaVersion' | 'id' | 'asOf' | 'drawdown'>
const cases: Record<string, Case> = {
  'working, saving well': {
    people: [a(40, 65)],
    incomes: [salary('a', 120000)],
    accounts: [rrsp('r', 'a', 100000, 12000), tfsa('t', 'a', 50000, 7000), nonreg('n', 'a', 40000, 20000)],
    expenses: budget(50000, 10000),
  },
  'working, cannot afford the saving': {
    people: [a(40, 65)],
    incomes: [salary('a', 40000)],
    accounts: [rrsp('r', 'a', 20000, 30000), tfsa('t', 'a', 5000, 7000)],
    expenses: budget(32000, 3000),
  },
  'retired on a RRIF, forced minimum': {
    people: [a(78, 65)],
    accounts: [rrif('r', 'a', 900000), nonreg('n', 'a', 0, 0)],
    expenses: budget(30000),
  },
  'retired, money runs out': {
    people: [a(70, 65, { lifeExpectancy: 90 })],
    accounts: [rrif('r', 'a', 120000), tfsa('t', 'a', 30000)],
    expenses: budget(60000, 10000),
  },
  'couple, first death rolls over': {
    people: [a(70, 65, { lifeExpectancy: 75 }), b(66, 65, { lifeExpectancy: 85 })],
    accounts: [rrif('r', 'a', 400000), tfsa('t', 'b', 80000)],
    expenses: budget(45000, 10000),
  },
  'sale with a mortgage the proceeds cover': {
    people: [a(70, 65)],
    accounts: [tfsa('t', 'a', 100000)],
    properties: [{ id: 'h', ownerId: 'a', value: 500000, acb: 200000, isPrincipalResidence: false, annualCosts: 5000, sale: { at: { kind: 'year', year: YEAR + 1 } } }],
    debts: [{ id: 'm', balance: 150000, interestRatePct: 4, monthlyPayment: 1200, propertyId: 'h' }],
    expenses: budget(30000),
  },
  'sale with a mortgage bigger than the home': {
    people: [a(70, 65)],
    accounts: [rrif('r', 'a', 400000)],
    properties: [{ id: 'h', ownerId: 'a', value: 100000, sale: { at: { kind: 'now' }, sellingCostPct: 0, replacementValue: 50000 } }],
    debts: [{ id: 'm', balance: 200000, interestRatePct: 0, monthlyPayment: 0, propertyId: 'h' }],
    expenses: budget(30000),
  },
  'a debt nobody can pay': {
    people: [a(70, 65, { cpp: { mode: 'amount', amountAt65: 0 }, oas: { startAge: 65, yearsInCanadaAfter18: 0 }, lifeExpectancy: 80 })],
    debts: [{ id: 'l', balance: 20000, interestRatePct: 8, monthlyPayment: 900 }],
    expenses: budget(0),
  },
  'stock pay with ESPP and sell to cover': {
    people: [a(50, 60)],
    incomes: [salary('a', 150000)],
    accounts: [{
      id: 's', ownerId: 'a', type: 'STOCK', balance: 0,
      holdings: [{ id: 'h', symbol: 'X', shares: 500, priceUsd: 100, rsuGrants: [{ id: 'g', shares: 200, vestAt: { kind: 'year', year: YEAR + 2 } }], espp: { annualContribution: 8000 } }],
    }, tfsa('t', 'a', 30000, 5000)],
    expenses: budget(60000),
  },
  'ESPP with too little cash': {
    people: [a(50, 60)],
    incomes: [salary('a', 45000)],
    accounts: [{ id: 's', ownerId: 'a', type: 'STOCK', balance: 0, holdings: [{ id: 'h', symbol: 'X', shares: 0, priceUsd: 100, espp: { annualContribution: 20000 } }] }],
    expenses: budget(30000),
  },
  'windfall and taxable receipts': {
    people: [a(55, 60)],
    incomes: [salary('a', 90000), { id: 'w', ownerId: 'a', kind: 'windfall', amount: 250000, frequency: 'oneTime', from: { kind: 'year', year: YEAR + 3 }, taxTreatment: 'capitalGain' }],
    accounts: [rrsp('r', 'a', 300000, 10000)],
    expenses: budget(45000),
  },
  'RRSP refunds reinvested past TFSA room': {
    people: [a(45, 65, { room: { tfsa: 0 } })],
    incomes: [salary('a', 200000)],
    accounts: [rrsp('r', 'a', 100000, 30000), tfsa('t', 'a', 0)],
    assumptions: { reinvestRrspRefund: true },
    expenses: budget(60000),
  },
}

const parse = (c: Case, drawdown: PlanV2Input['drawdown']): PlanV2 => planSchema.parse({ schemaVersion: 2, id: 'p', asOf: `${YEAR}-01-01`, drawdown, ...c })

describe('accounting identities', () => {
  for (const [name, c] of Object.entries(cases)) {
    for (const drawdown of strategies) {
      for (const [returnPct, inflationPct] of [[0, 0], [5, 2], [-3, 4]]) {
        const label = `${name} / ${drawdown!.strategy!.kind} / ${returnPct}%`
        it(label, () => {
          const compiled = compilePlan(parse(c, drawdown), { startYear: YEAR })
          const { rows } = simulate(compiled, deterministicPath(compiled.years, returnPct, inflationPct))
          for (const row of rows) {
            checkBalances(row, label)
            checkCash(row, label)
          }
        })
      }
    }
  }

  it('reconciles balances in simple mode too', () => {
    const c: Case = {
      people: [a(62, 60)],
      accounts: [rrif('r', 'a', 500000), tfsa('t', 'a', 50000)],
      properties: [{ id: 'h', ownerId: 'a', value: 500000, acb: 100000, isPrincipalResidence: false, sale: { at: { kind: 'year', year: YEAR + 2 } } }],
      incomes: [{ id: 'w', ownerId: 'a', kind: 'windfall', amount: 50000, frequency: 'oneTime', from: { kind: 'year', year: YEAR + 4 } }],
      expenses: { mode: 'simple', items: [{ id: 'g', category: 'gift', amount: 20000, frequency: 'oneTime', from: { kind: 'year', year: YEAR + 3 } }] },
    }
    const compiled = compilePlan(parse(c, { strategy: { kind: 'initialPct', ratePct: 4 } }), { startYear: YEAR })
    for (const row of simulate(compiled, deterministicPath(compiled.years, 5, 2)).rows) checkBalances(row, 'simple')
  })
})
