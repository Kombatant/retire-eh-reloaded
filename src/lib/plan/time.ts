import type { PersonV2, PlanV2, TimePoint } from './schema'

export function personAgeInYear(person: Pick<PersonV2, 'birthYear'>, year: number): number {
  return year - person.birthYear
}

// Resolve a TimePoint to a calendar year. A point that references a person who
// no longer exists falls back, so a stale reference can never crash a projection.
export function resolveYear(
  point: TimePoint | undefined,
  people: readonly Pick<PersonV2, 'id' | 'birthYear' | 'retirementAge'>[],
  startYear: number,
  fallback: number,
): number {
  if (!point) return fallback
  switch (point.kind) {
    case 'now':
      return startYear
    case 'year':
      return point.year
    case 'age': {
      const person = people.find(p => p.id === point.personId)
      return person ? person.birthYear + point.age : fallback
    }
    case 'retirement': {
      const person = people.find(p => p.id === point.personId)
      return person ? person.birthYear + person.retirementAge + (point.offset ?? 0) : fallback
    }
  }
}

export function youngestPerson<T extends Pick<PersonV2, 'birthYear'>>(people: readonly T[]): T | undefined {
  // Youngest = latest birth year. Ties keep the first person, matching the v1
  // "minimum current age" household axis.
  return people.reduce<T | undefined>((best, p) => (!best || p.birthYear > best.birthYear ? p : best), undefined)
}

// Rewrite every TimePoint that depends on `personId` into a fixed calendar
// year, so deleting a person keeps their events on the same dates.
export function detachPersonTimePoints(plan: PlanV2, personId: string, startYear: number): PlanV2 {
  const fix = (point: TimePoint | undefined): TimePoint | undefined => {
    if (!point) return point
    if ((point.kind === 'age' || point.kind === 'retirement') && point.personId === personId) {
      return { kind: 'year', year: resolveYear(point, plan.people, startYear, startYear) }
    }
    return point
  }
  const fixRequired = (point: TimePoint): TimePoint => fix(point) ?? point
  return {
    ...plan,
    accounts: plan.accounts.map(a => ({
      ...a,
      contributions: a.contributions.map(c => ({ ...c, from: fix(c.from), to: fix(c.to) })),
    })),
    incomes: plan.incomes.map(i => ({ ...i, from: fix(i.from), to: fix(i.to) })),
    expenses: {
      ...plan.expenses,
      phases: plan.expenses.phases.map(ph => ({ ...ph, from: fixRequired(ph.from), to: fix(ph.to) })),
      items: plan.expenses.items.map(it => ({ ...it, from: fix(it.from), to: fix(it.to) })),
    },
    properties: plan.properties.map(pr => (pr.sale ? { ...pr, sale: { ...pr.sale, at: fixRequired(pr.sale.at) } } : pr)),
  }
}
