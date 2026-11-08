import type { PlanV2 } from '@/lib/plan/schema'
import type { CompiledPlan, SimResult } from '@/lib/sim/types'
import type { FiMetrics } from './fi'

export interface Milestone {
  year: number
  label: string
  kind: 'retire' | 'benefit' | 'rrif' | 'debt' | 'home' | 'fi' | 'risk' | 'life'
}

// Key events on the plan's timeline, in date order.
export function buildMilestones(plan: PlanV2, c: CompiledPlan, result: SimResult, fi?: FiMetrics | null): Milestone[] {
  const out: Milestone[] = []
  const multi = plan.people.length > 1
  const who = (name: string) => (multi ? `${name}: ` : '')

  plan.people.forEach(p => {
    out.push({ year: p.birthYear + p.retirementAge, label: `${who(p.name)}Retire at ${p.retirementAge}`, kind: 'retire' })
    out.push({ year: p.birthYear + p.cppStartAge, label: `${who(p.name)}${p.province === 'QC' ? 'QPP' : 'CPP'} starts at ${p.cppStartAge}`, kind: 'benefit' })
    out.push({ year: p.birthYear + p.oas.startAge, label: `${who(p.name)}OAS starts at ${p.oas.startAge}`, kind: 'benefit' })
    const conversionAges = new Set(plan.accounts.flatMap(a => (
      a.ownerId === p.id && a.type === 'RRSP' ? [a.rrifConversionAge ?? plan.drawdown.rrifConversionAge] : []
    )))
    for (const age of conversionAges) {
      out.push({ year: p.birthYear + age, label: `${who(p.name)}RRSP converts to a RRIF`, kind: 'rrif' })
    }
    out.push({ year: p.birthYear + p.lifeExpectancy, label: `${who(p.name)}Plan to age ${p.lifeExpectancy}`, kind: 'life' })
  })

  const rows = result.rows
  const debtFree = rows.findIndex((r, i) => r.debtBalance <= 0.5 && i > 0 && rows[i - 1].debtBalance > 0.5)
  if (debtFree >= 0) out.push({ year: rows[debtFree].year, label: 'Debt-free', kind: 'debt' })
  else if (rows[0] && rows[0].debtBalance <= 0.5 && plan.debts.some(d => d.balance > 0)) out.push({ year: rows[0].year, label: 'Debt-free', kind: 'debt' })

  plan.properties.forEach((prop, i) => {
    const sale = c.properties[i]?.saleOffset ?? -1
    if (sale >= 0) {
      out.push({ year: c.startYear + sale, label: prop.sale?.replacementValue ? `Downsize ${prop.label || 'home'}` : `Sell ${prop.label || 'home'}`, kind: 'home' })
    }
  })

  if (fi?.fiYear) out.push({ year: fi.fiYear, label: 'Financially independent', kind: 'fi' })
  if (fi?.coastYear) out.push({ year: fi.coastYear, label: 'Coast FI: could stop saving', kind: 'fi' })
  if (result.depletionOffset !== null) out.push({ year: c.startYear + result.depletionOffset, label: 'Portfolio runs out', kind: 'risk' })

  return out
    .filter(m => m.year >= c.startYear && m.year < c.startYear + c.years + 1)
    .sort((a, b) => a.year - b.year || a.label.localeCompare(b.label))
}
