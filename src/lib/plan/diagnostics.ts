import type { PlanV2, TimePoint } from './schema'
import { mapPlanTimePoints, resolveYear } from './time'

// Problems the projection cannot honour, reported rather than rejected. These
// deliberately sit outside planSchema: a plan that loads today must keep
// loading, and a schema failure would stop it being saved or opened.
export interface PlanDiagnostic {
  message: string
}

const INDIVIDUAL_ONLY_ACCOUNTS = new Set(['RRSP', 'RRIF', 'TFSA', 'FHSA', 'LIRA', 'LIF'])

export function isRealDate(iso: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return false
  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function diagnosePlan(plan: PlanV2, now: Date): PlanDiagnostic[] {
  const out: string[] = []

  if (plan.people.length > 2) {
    out.push('This plan has more than two people. Pension splitting and survivor rules only apply to one or two.')
  }

  if (!isRealDate(plan.asOf)) {
    out.push(`The balance date "${plan.asOf}" is not a real date.`)
  } else if (Number(plan.asOf.slice(0, 4)) < now.getFullYear()) {
    out.push(`Balances were last updated on ${plan.asOf}, but the projection starts from them in ${now.getFullYear()}. Update them under Savings or Tracking.`)
  }

  for (const income of plan.incomes) {
    if (income.ownerId === 'joint') out.push(`Income "${income.label || income.kind}" is set to joint and is left out of the projection. Give it one owner.`)
  }
  for (const account of plan.accounts) {
    if (account.ownerId === 'joint' && INDIVIDUAL_ONLY_ACCOUNTS.has(account.type)) {
      out.push(`${account.type} account "${account.label || account.id}" is set to joint, but these accounts have one owner. Withdrawal rules and tax may be wrong.`)
    }
  }

  // A RRIF cannot take contributions, so a schedule must end by conversion.
  for (const account of plan.accounts) {
    if (account.type !== 'RRSP') continue
    const owner = plan.people.find(p => p.id === account.ownerId)
    if (!owner) continue
    const conversionAge = account.rrifConversionAge ?? plan.drawdown.rrifConversionAge
    const conversionYear = owner.birthYear + conversionAge
    const lastContribution = Math.max(-Infinity, ...account.contributions
      .filter(rule => rule.amount > 0)
      .map(rule => resolveYear(rule.to, plan.people, now.getFullYear(), owner.birthYear + owner.retirementAge) - 1))
    if (lastContribution > conversionYear) {
      out.push(`RRSP "${account.label || account.id}" converts to a RRIF at ${conversionAge}, but contributions continue until ${lastContribution}. A RRIF cannot take contributions.`)
    }
  }

  const duplicates = (label: string, ids: string[]) => {
    const seen = new Set<string>()
    for (const id of ids) {
      if (seen.has(id)) out.push(`Two ${label} share the id "${id}".`)
      seen.add(id)
    }
  }
  duplicates('accounts', plan.accounts.map(a => a.id))
  duplicates('income streams', plan.incomes.map(i => i.id))
  duplicates('expenses', plan.expenses.items.map(e => e.id))
  duplicates('properties', plan.properties.map(p => p.id))
  duplicates('debts', plan.debts.map(d => d.id))

  const personIds = new Set(plan.people.map(p => p.id))
  let danglingDates = 0
  mapPlanTimePoints(plan, (point: TimePoint) => {
    if ((point.kind === 'age' || point.kind === 'retirement') && !personIds.has(point.personId)) danglingDates++
    return point
  })
  if (danglingDates > 0) {
    out.push(`${danglingDates} date${danglingDates === 1 ? ' refers' : 's refer'} to a person who is not in this plan, so a default date is used instead.`)
  }

  const propertyIds = new Set(plan.properties.map(p => p.id))
  for (const debt of plan.debts) {
    if (debt.propertyId && !propertyIds.has(debt.propertyId)) out.push(`Debt "${debt.label || debt.id}" is linked to a property that is not in this plan.`)
  }

  return [...new Set(out)].map(message => ({ message }))
}
