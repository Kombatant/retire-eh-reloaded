import { useState } from 'react'
import { Wallet } from 'lucide-react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { addIncome, newIncome, patchIncome, removeIncome, type IncomeTemplate } from '@/lib/plan/edits'
import type { IncomeStream } from '@/lib/plan/schema'
import { describeTimePoint } from '@/lib/plan/timeLabels'
import { money } from '@/lib/formatting'
import { Card, CardHeader } from '@/components/ui/Card'
import { ListFrame, ListRow } from '@/components/ui/ListRow'
import { AddMenu } from '@/components/ui/AddMenu'
import { Sheet } from '@/components/ui/Sheet'
import { Field } from '@/components/ui/Field'
import { PercentInput, Select, TextInput } from '@/components/ui/inputs'
import { NumberInput } from '@/components/ui/NumberInput'
import { TimePointPicker } from '@/components/ui/TimePointPicker'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Advanced } from '@/components/ui/Advanced'

const TEMPLATES: { key: IncomeTemplate; label: string }[] = [
  { key: 'salary', label: 'Salary' },
  { key: 'partTime', label: 'Part-time / semi-retirement' },
  { key: 'dbPension', label: 'Employer (DB) pension' },
  { key: 'rental', label: 'Rental income' },
  { key: 'windfall', label: 'One-time (inheritance, bonus)' },
  { key: 'other', label: 'Other income' },
]

const KIND_LABELS: Record<IncomeStream['kind'], string> = {
  employment: 'Employment',
  selfEmployment: 'Self-employment',
  rental: 'Rental',
  dbPension: 'DB pension',
  annuity: 'Annuity',
  windfall: 'One-time',
  other: 'Other',
}

export function IncomeSection() {
  const { activePlan, updateActivePlan, selectedPersonId } = usePlanStore()
  const [editingId, setEditingId] = useState<string | null>(null)
  const people = activePlan.people
  const ownerId = selectedPersonId ?? people[0]?.id
  const editing = activePlan.incomes.find(i => i.id === editingId) ?? null

  const add = (template: IncomeTemplate) => {
    if (!ownerId) return
    const income = newIncome(template, ownerId)
    updateActivePlan(p => addIncome(p, income))
    setEditingId(income.id)
  }

  return (
    <>
      <Card>
        <CardHeader
          title="Income sources"
          description="Salaries, workplace pensions, rental income and one-time amounts. CPP and OAS are set under Household."
          actions={<AddMenu label="Add income" items={TEMPLATES.map(t => ({ key: t.key, label: t.label, onSelect: () => add(t.key) }))} />}
        />
        {activePlan.incomes.length === 0 ? (
          <EmptyState icon={Wallet} title="No income yet" description="Add your salary so the plan knows what you earn until you retire." />
        ) : (
          <div className="space-y-4">
            {people.map(person => {
              const streams = activePlan.incomes.filter(i => i.ownerId === person.id)
              if (streams.length === 0) return null
              return (
                <div key={person.id}>
                  {people.length > 1 && <div className="mb-1.5 text-xs font-medium text-fg-muted">{person.name}</div>}
                  <ListFrame>
                    {streams.map(income => {
                      const oneTime = income.frequency === 'oneTime'
                      const when = oneTime
                        ? describeTimePoint(income.from, people, 'Now')
                        : `${describeTimePoint(income.from, people, 'Now')} → ${describeTimePoint(income.to, people, 'End of plan')}`
                      return (
                        <ListRow
                          key={income.id}
                          leading={<Badge>{KIND_LABELS[income.kind]}</Badge>}
                          title={income.label || KIND_LABELS[income.kind]}
                          subtitle={when}
                          value={money(income.amount)}
                          valueSub={oneTime ? 'once' : 'per year'}
                          onOpen={() => setEditingId(income.id)}
                          openLabel={`Edit ${income.label}`}
                          onRemove={() => updateActivePlan(p => removeIncome(p, income.id))}
                          removeLabel={`Remove ${income.label}`}
                        />
                      )
                    })}
                  </ListFrame>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <Sheet
        open={editing !== null}
        onClose={() => setEditingId(null)}
        title={editing ? (editing.label || KIND_LABELS[editing.kind]) : ''}
        description={editing ? KIND_LABELS[editing.kind] : undefined}
      >
        {editing && <IncomeEditor income={editing} />}
      </Sheet>
    </>
  )
}

function IncomeEditor({ income }: { income: IncomeStream }) {
  const { activePlan, updateActivePlan, nowYear } = usePlanStore()
  const update = (patch: Partial<IncomeStream>) => updateActivePlan(p => patchIncome(p, income.id, patch))
  const oneTime = income.frequency === 'oneTime'
  const db = income.db

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Name">
          <TextInput value={income.label} onChange={(e) => update({ label: e.target.value })} />
        </Field>
        {activePlan.people.length > 1 && (
          <Field label="Person">
            <Select value={income.ownerId} onChange={(e) => update({ ownerId: e.target.value })}>
              {activePlan.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label={oneTime ? 'Amount' : 'Amount per year'} hint="Before tax, in today's dollars.">
          <NumberInput value={income.amount} min={0} onChange={(v) => update({ amount: v })} />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 border-t border-border pt-5">
        <Field label={oneTime ? 'Received' : 'Starts'}>
          <TimePointPicker value={income.from} onChange={(v) => update({ from: v })} personId={income.ownerId} unsetLabel="Now" currentYear={nowYear} />
        </Field>
        {!oneTime && (
          <Field label="Ends">
            <TimePointPicker value={income.to} onChange={(v) => update({ to: v })} personId={income.ownerId} unsetLabel="End of plan" currentYear={nowYear} />
          </Field>
        )}
        {oneTime && (
          <p className="text-xs text-fg-muted">One-time amounts are invested in a non-registered account in the year they arrive.</p>
        )}
      </div>

      {!oneTime && (
        <div className="grid grid-cols-1 gap-4 border-t border-border pt-5 sm:grid-cols-2">
          <Field
            label="Yearly change"
            info="Inflation-linked keeps purchasing power (plus any raise you enter). Fixed grows by a set % a year. Flat stays the same dollar amount, so it shrinks after inflation."
          >
            <Select
              value={income.growth.kind}
              onChange={(e) => update({ growth: { ...income.growth, kind: e.target.value as IncomeStream['growth']['kind'] } })}
            >
              <option value="cpi">Inflation plus</option>
              <option value="fixed">Fixed %</option>
              <option value="none">Flat</option>
            </Select>
          </Field>
          {income.growth.kind !== 'none' && (
            <Field label={income.growth.kind === 'cpi' ? 'Raise above inflation' : 'Growth per year'}>
              <PercentInput value={income.growth.pct} onChange={(v) => update({ growth: { ...income.growth, pct: v } })} />
            </Field>
          )}
        </div>
      )}

      <Advanced>
        <div className="grid grid-cols-1 gap-4 border-t border-border pt-5 sm:grid-cols-2">
          <Field label="Tax treatment">
            <Select value={income.taxTreatment} onChange={(e) => update({ taxTreatment: e.target.value as IncomeStream['taxTreatment'] })}>
              <option value="ordinary">Taxable income</option>
              <option value="nonTaxable">Not taxable</option>
              <option value="capitalGain">Capital gain</option>
              <option value="eligibleDividend">Eligible dividend</option>
            </Select>
          </Field>
          {income.kind === 'dbPension' && (
            <>
              <Field label="Indexed to inflation" info="Share of each year's inflation the pension rises by once paid. Public-sector plans are often 100%; many private plans less.">
                <PercentInput
                  value={db?.indexationPctOfCpi ?? 100}
                  min={0}
                  max={100}
                  onChange={(v) => update({ db: { survivorPct: 60, ...db, indexationPctOfCpi: v } })}
                />
              </Field>
              <Field label="Bridge benefit per year" info="Extra pension paid from retirement until 65, when CPP and OAS usually begin.">
                <NumberInput
                  value={db?.bridge?.amount ?? 0}
                  min={0}
                  onChange={(v) => update({
                    db: { indexationPctOfCpi: 100, survivorPct: 60, ...db, bridge: v > 0 ? { amount: v, untilAge: db?.bridge?.untilAge ?? 65 } : undefined },
                  })}
                />
              </Field>
              <Field label="Survivor pension" info="Share of the pension that continues to a surviving spouse.">
                <PercentInput
                  value={db?.survivorPct ?? 60}
                  min={0}
                  max={100}
                  onChange={(v) => update({ db: { indexationPctOfCpi: 100, ...db, survivorPct: v } })}
                />
              </Field>
            </>
          )}
        </div>
      </Advanced>
    </div>
  )
}
