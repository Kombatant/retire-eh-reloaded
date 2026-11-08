import type { PlanV2 } from './schema'

type NamedPlan = Pick<PlanV2, 'name'>

const comparable = (name: string) => name.trim().toLocaleLowerCase()

// Case and stray spaces are ignored: "my plan " and "My plan" look like the
// same entry in the plan menu.
export function isPlanNameTaken(name: string, plans: NamedPlan[]): boolean {
  const target = comparable(name)
  return plans.some(plan => comparable(plan.name) === target)
}

export function suggestPlanName(name: string, plans: NamedPlan[]): string {
  const base = name.trim()
  let n = 2
  while (isPlanNameTaken(`${base} (${n})`, plans)) n += 1
  return `${base} (${n})`
}
