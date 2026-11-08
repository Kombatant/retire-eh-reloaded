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

// Apply `fix` to every TimePoint in a plan. All date-bearing fields go through
// here, so a new one only has to be added once.
export function mapPlanTimePoints(plan: PlanV2, fix: (point: TimePoint) => TimePoint): PlanV2 {
  const opt = (point: TimePoint | undefined) => (point ? fix(point) : point)
  return {
    ...plan,
    accounts: plan.accounts.map(a => {
      const account = { ...a, contributions: a.contributions.map(c => ({ ...c, from: opt(c.from), to: opt(c.to) })) }
      if (account.type !== 'STOCK') return account
      return {
        ...account,
        holdings: account.holdings.map(h => ({
          ...h,
          rsuGrants: h.rsuGrants.map(g => ({ ...g, vestAt: fix(g.vestAt) })),
          espp: h.espp ? { ...h.espp, from: opt(h.espp.from), to: opt(h.espp.to) } : h.espp,
        })),
        salePlan: account.salePlan.kind === 'none'
          ? account.salePlan
          : { ...account.salePlan, from: opt(account.salePlan.from), to: opt(account.salePlan.to) },
      }
    }),
    incomes: plan.incomes.map(i => ({ ...i, from: opt(i.from), to: opt(i.to) })),
    expenses: {
      ...plan.expenses,
      phases: plan.expenses.phases.map(ph => ({ ...ph, from: fix(ph.from), to: opt(ph.to) })),
      items: plan.expenses.items.map(it => ({ ...it, from: opt(it.from), to: opt(it.to) })),
    },
    properties: plan.properties.map(pr => (pr.sale ? { ...pr, sale: { ...pr.sale, at: fix(pr.sale.at) } } : pr)),
  }
}

// Rewrite every TimePoint that depends on `personId` into a fixed calendar
// year, so deleting a person keeps their events on the same dates.
export function detachPersonTimePoints(plan: PlanV2, personId: string, startYear: number): PlanV2 {
  return mapPlanTimePoints(plan, point => (
    (point.kind === 'age' || point.kind === 'retirement') && point.personId === personId
      ? { kind: 'year', year: resolveYear(point, plan.people, startYear, startYear) }
      : point
  ))
}
