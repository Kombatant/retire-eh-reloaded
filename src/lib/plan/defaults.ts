import { planSchema, MAX_CPP_ANNUAL_2026, type PersonV2, type PlanV2, type ProvinceCode } from './schema'
import { newId } from './ids'

// Province for brand-new plans. Migrated plans keep Quebec (see migrate.ts).
export const DEFAULT_PROVINCE: ProvinceCode = 'ON'

export function isoDate(now: Date): string {
  return now.toISOString().slice(0, 10)
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
    cpp: { mode: 'amount', amountAt65: MAX_CPP_ANNUAL_2026 },
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
