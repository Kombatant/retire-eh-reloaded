import { planSchema, type PersonV2, type PlanV2, type ProvinceCode } from './schema'
import { newId } from './ids'

// Province for brand-new plans. Migrated plans keep Quebec (see migrate.ts).
export const DEFAULT_PROVINCE: ProvinceCode = 'ON'

// The local calendar date. toISOString() is UTC, which is already tomorrow on
// a Canadian evening and next year on the evening of December 31.
export function isoDate(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function createDefaultPerson(params: {
  id?: string
  name: string
  currentAge: number
  now: Date
  province?: ProvinceCode
}): PersonV2 {
  return {
    id: params.id ?? newId('person'),
    name: params.name,
    birthYear: params.now.getFullYear() - params.currentAge,
    province: params.province ?? DEFAULT_PROVINCE,
    retirementAge: 65,
    lifeExpectancy: 95,
    // New people get a CPP estimate from a typical work history (starting at
    // 22, earning their current salary), which they can refine or replace
    // with their statement amount.
    cpp: { mode: 'history', startedWorkingYear: params.now.getFullYear() - params.currentAge + 22, yearsNotWorking: 0, childRearingYears: 0 },
    cppStartAge: 65,
    oas: { startAge: 65, yearsInCanadaAfter18: 40 },
  }
}

// The starter plan mirrors the original app defaults so first-time users see
// the same example household.
export function createDefaultPlan(now: Date = new Date(), name = 'My plan'): PlanV2 {
  const person = createDefaultPerson({ id: '1', name: 'You', currentAge: 35, now })
  return planSchema.parse({
    schemaVersion: 2,
    id: newId('plan'),
    name,
    asOf: isoDate(now),
    people: [person],
    // Written out so existing plans, which fall back on schema defaults, keep
    // their own assumptions. 60/40 at the FP Canada 2026 guidelines is about 5.06%,
    // less about 0.5% for fees; inflation is above the guideline's 2.1% on purpose.
    assumptions: {
      expectedReturn: 4.5,
      inflationRate: 2.5,
      assetReturns: { equityPct: 6.3, bondPct: 3.2, cashPct: 2.4 },
    },
    drawdown: { strategy: { kind: 'expenses' } },
    accounts: [
      { id: '1-1', ownerId: person.id, type: 'RRSP', balance: 100000, contributions: [] },
      { id: '1-2', ownerId: person.id, type: 'TFSA', balance: 80000, contributions: [] },
    ],
    incomes: [
      {
        id: newId('income'),
        ownerId: person.id,
        label: 'Salary',
        kind: 'employment',
        amount: 100000,
        to: { kind: 'retirement', personId: person.id },
      },
    ],
  })
}
