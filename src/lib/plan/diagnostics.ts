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
  } else if (!plan.asOf.endsWith('-01-01')) {
    const year = Number(plan.asOf.slice(0, 4))
    const datedThisYear = (from: TimePoint | undefined) => resolveYear(from, plan.people, year, year) === year
    const oneTime = [
      ...plan.incomes.filter(i => i.frequency === 'oneTime' && datedThisYear(i.from)).map(i => i.label || 'One-time income'),
      ...plan.expenses.items.filter(e => e.frequency === 'oneTime' && datedThisYear(e.from)).map(e => e.label || 'One-time cost'),
    ]
    for (const label of oneTime) {
      out.push(`"${label}" is dated ${year}. If it has already happened, it is in your balances; remove it or it will be counted again.`)
    }
  }

  for (const person of plan.people) {
    const age = now.getFullYear() - person.birthYear
    if (person.lifeExpectancy <= age) out.push(`${person.name} is ${age}, at or past the plan's life expectancy of ${person.lifeExpectancy}.`)
    else if (person.retirementAge > person.lifeExpectancy) out.push(`${person.name} retires at ${person.retirementAge}, after the plan's life expectancy of ${person.lifeExpectancy}.`)
    if (person.room) {
      for (const [type, room] of [['RRSP', person.room.rrsp], ['TFSA', person.room.tfsa]] as const) {
        if (room === undefined) continue
        const planned = plan.accounts
          .filter(a => a.ownerId === person.id && a.type === type)
          .reduce((total, a) => total + a.contributions.reduce((s, c) => s + (resolveYear(c.from, plan.people, now.getFullYear(), now.getFullYear()) <= now.getFullYear() ? c.amount : 0), 0), 0)
        if (planned > room) out.push(`${person.name}'s planned ${type} contributions this year are more than the ${type} room entered; the excess goes to a non-registered account.`)
      }
    }
  }

  for (const income of plan.incomes) {
    if (income.ownerId === 'joint') out.push(`Income "${income.label || income.kind}" is set to joint and is left out of the projection. Give it one owner.`)
  }
  for (const account of plan.accounts) {
    if (account.ownerId === 'joint' && INDIVIDUAL_ONLY_ACCOUNTS.has(account.type)) {
      out.push(`${account.type} account "${account.label || account.id}" is set to joint, but these accounts have one owner. Withdrawal rules and tax may be wrong.`)
    }
  }

  for (const account of plan.accounts) {
    if (account.type === 'NONREG' && account.balance > 0 && !account.yields) {
      out.push(`Non-registered account "${account.label || account.id}" has no yearly distributions set, so no tax is charged on them until it is sold. Add an estimate under Savings.`)
    }
  }

  for (const account of plan.accounts) {
    if (account.type !== 'STOCK' || account.ownerId !== 'joint') continue
    if (account.holdings.some(h => h.espp || h.rsuGrants.length > 0)) {
      out.push(`Stock account "${account.label || account.id}" is set to joint, so its RSUs and ESPP are left out. Give it one owner.`)
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
