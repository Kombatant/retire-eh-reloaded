import { describe, it, expect } from 'vitest'
import { buildCombinedProjection } from '@/lib/legacy/combinedProjection'
import { buildRetirementCashFlow } from '@/lib/legacy/retirementCashFlow'
import { migrateV1ToV2 } from '@/lib/plan/migrate'
import { simulatePlan, toCashFlowRows, toProjectionData } from '@/lib/sim'
import type { Person } from '@/types/person'
import type { PlanAssumptions, RetirementPlan } from '@/types/plan'

// The unified engine must reproduce the original engine wherever the original
// was internally consistent. Fixtures follow projection-consistency.test.tsx.

const NOW = new Date()
const YEAR = NOW.getFullYear()

const couple: Person[] = [
  {
    id: '1', name: 'Simon', currentAge: 34, retirementAge: 65, annualIncome: 140000, annualPension: 0,
    annualCpp: 18100, cppStartAge: 65, oasStartAge: 65,
    accounts: [
      { id: '1-1', type: 'RRSP', balance: 48000, annualContribution: 6000 },
      { id: '1-2', type: 'TFSA', balance: 29000, annualContribution: 7000 },
    ],
  },
  {
    id: '2', name: 'Jessie', currentAge: 35, retirementAge: 58, annualIncome: 90000, annualPension: 70000,
    annualCpp: 18100, cppStartAge: 70, oasStartAge: 68,
    accounts: [
      { id: '2-1', type: 'RRSP', balance: 30000, annualContribution: 9000 },
      { id: '2-2', type: 'TFSA', balance: 80000, annualContribution: 0 },
    ],
  },
]

const single: Person[] = [
  {
    id: 's', name: 'Solo', currentAge: 45, retirementAge: 62, annualIncome: 120000, annualPension: 0,
    annualCpp: 15000, cppStartAge: 60, oasStartAge: 70,
    accounts: [
      { id: 's-1', type: 'RRSP', balance: 400000, annualContribution: 15000 },
      { id: 's-2', type: 'TFSA', balance: 60000, annualContribution: 7000 },
    ],
  },
]

function assumptions(overrides: Partial<PlanAssumptions> = {}): PlanAssumptions {
  return {
    expectedReturn: 7, inflationRate: 2.5, replacementRate: 70, withdrawalRate: 4, showRealValues: true,
    plannedGifts: [], workingMarginalTaxRate: 30, reinvestRrspRefund: false, ...overrides,
  }
}

function legacy(people: Person[], a: PlanAssumptions, showReal: boolean) {
  const householdRetirementAge = Math.max(...people.map(p => p.retirementAge))
  const yearsToRetirement = householdRetirementAge - Math.min(...people.map(p => p.currentAge))
  const projection = buildCombinedProjection(
    people, a.expectedReturn, a.inflationRate, showReal, householdRetirementAge,
    a.workingMarginalTaxRate, a.reinvestRrspRefund,
  )
  const real = buildCombinedProjection(
    people, a.expectedReturn, a.inflationRate, true, householdRetirementAge,
    a.workingMarginalTaxRate, a.reinvestRrspRefund,
  )
  const last = real.at(-1)!
  const cashFlow = buildRetirementCashFlow({
    people,
    rrspAtRetirement: last.RRSP ?? 0,
    tfsaAtRetirement: last.TFSA ?? 0,
    expectedReturnPct: a.expectedReturn,
    inflationPct: a.inflationRate,
    withdrawalRatePct: a.withdrawalRate,
    householdRetirementAge,
    yearsToRetirement,
    showRealValues: showReal,
    plannedGifts: a.plannedGifts,
    currentYear: YEAR,
  })
  return { projection, cashFlow }
}

function engine(people: Person[], a: PlanAssumptions, showReal: boolean) {
  const v1: RetirementPlan = { version: '1.0', assumptions: a, people }
  const { plan } = migrateV1ToV2(v1, { now: NOW })
  const { compiled, result } = simulatePlan(plan, { startYear: YEAR, rules: 'v1' })
  return {
    projection: toProjectionData(compiled, result, showReal),
    cashFlow: toCashFlowRows(compiled, result, showReal),
  }
}

function expectRowsClose<T extends object>(actual: T[], expected: T[]) {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((row, i) => {
    for (const [key, value] of Object.entries(expected[i])) {
      const got = (row as Record<string, unknown>)[key]
      if (typeof value === 'number') {
        expect(Math.abs((got as number) - value), `row ${i} ${key}: ${got} vs ${value}`).toBeLessThan(1)
      } else {
        expect(got, `row ${i} ${key}`).toEqual(value)
      }
    }
  })
}

const scenarios: [string, Person[], PlanAssumptions][] = [
  ['couple, real dollars', couple, assumptions()],
  ['couple, nominal dollars', couple, assumptions({ showRealValues: false })],
  ['couple with gifts at retirement', couple, assumptions({
    plannedGifts: [
      { id: 'g1', label: 'A', amount: 100000, age: 65 },
      { id: 'g2', label: 'B', amount: 40000, age: 72 },
    ],
  })],
  ['couple with reinvested RRSP refunds', couple, assumptions({ reinvestRrspRefund: true, workingMarginalTaxRate: 37 })],
  ['single, low return, high inflation', single, assumptions({ expectedReturn: 3, inflationRate: 4, withdrawalRate: 5 })],
  ['single, depletes before 95', single, assumptions({ withdrawalRate: 9 })],
]

describe('unified engine parity with the original engine', () => {
  for (const [name, people, a] of scenarios) {
    describe(name, () => {
      const showReal = a.showRealValues
      const expected = legacy(people, a, showReal)
      const actual = engine(people, a, showReal)

      it('matches the accumulation projection within $1', () => {
        expectRowsClose(actual.projection, expected.projection)
      })

      it('matches the retirement cash flow within $1', () => {
        // The original nominal-mode table valued end-of-year balances at
        // start-of-year prices; the new engine reports the true nominal value.
        const fixed = showReal
          ? expected.cashFlow
          : expected.cashFlow.map(row => ({ ...row, portfolioEnd: row.portfolioEnd * (1 + a.inflationRate / 100) }))
        expectRowsClose(actual.cashFlow, fixed)
      })
    })
  }

  it('keeps an early retiree compounding until the household retires', () => {
    const people: Person[] = [
      { id: 'a', name: 'A', currentAge: 35, retirementAge: 58, annualIncome: 0, annualPension: 0, accounts: [{ id: 'e', type: 'TFSA', balance: 100000, annualContribution: 0 }] },
      { id: 'b', name: 'B', currentAge: 35, retirementAge: 65, annualIncome: 0, annualPension: 0, accounts: [] },
    ]
    const a = assumptions({ showRealValues: false })
    expectRowsClose(engine(people, a, false).projection, legacy(people, a, false).projection)
  })
})
