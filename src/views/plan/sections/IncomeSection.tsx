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
import { Callout } from '@/components/ui/Callout'
import { Checkbox } from '@/components/ui/Checkbox'
import { useProjectionContext } from '@/contexts/ProjectionContext'

const TEMPLATES: { key: IncomeTemplate; label: string }[] = [
  { key: 'salary', label: 'Salary' },
  { key: 'cashBonus', label: 'Yearly cash bonus' },
  { key: 'rsuBonus', label: 'Yearly RSU bonus' },
  { key: 'partTime', label: 'Part-time / semi-retirement' },
  { key: 'dbPension', label: 'Employer (DB) pension' },
  { key: 'rental', label: 'Rental income' },
  { key: 'windfall', label: 'One-time (inheritance, gift)' },
  { key: 'other', label: 'Other income' },
]

const KIND_LABELS: Record<IncomeStream['kind'], string> = {
  employment: 'Employment',
  bonus: 'Cash bonus',
  rsu: 'RSU bonus',
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
          description="Salaries, bonuses, workplace pensions, rental income and one-time amounts. CPP and OAS are set under Household."
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
  const isRsu = income.kind === 'rsu'
  const isBonus = isRsu || income.kind === 'bonus'
  const investsLeftovers = activePlan.expenses.mode === 'detailed' && activePlan.expenses.surplusPolicy === 'save'

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
        <Field
          label={isRsu ? 'Typical value per year' : oneTime ? 'Amount' : 'Amount per year'}
          hint={isRsu ? "Value of the shares when they vest, before tax, in today's Canadian dollars." : "Before tax, in today's dollars."}
        >
          <NumberInput value={income.amount} min={0} onChange={(v) => update({ amount: v })} />
        </Field>
      </div>

      {income.kind === 'bonus' && (
        <div className="space-y-3">
          <p className="text-xs text-fg-muted">
            Counts as employment income in the year you receive it, on top of your salary. Employers often withhold a different amount from a bonus; that evens out when you file, so the plan uses your full-year tax.
          </p>
          {!investsLeftovers && (
            <Callout>
              This plan only invests the contributions you set under Savings, so the bonus adds tax but no savings on its own. Raise a contribution, or use a detailed budget with leftover cash invested.
            </Callout>
          )}
        </div>
      )}

      {isRsu && <RsuBonusFields income={income} />}

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

      {!isBonus && <Advanced>
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
      </Advanced>}
    </div>
  )
}

function RsuBonusFields({ income }: { income: IncomeStream }) {
  const { activePlan, updateActivePlan } = usePlanStore()
  const { simulation } = useProjectionContext()
  const rsu = income.rsu ?? { sellToCover: true }
  const update = (patch: Partial<NonNullable<IncomeStream['rsu']>>) =>
    updateActivePlan(p => patchIncome(p, income.id, { rsu: { ...rsu, ...patch } }))

  const holdings = activePlan.accounts.flatMap(a => (
    a.type === 'STOCK' && a.ownerId === income.ownerId
      ? a.holdings.map(h => ({ id: h.id, label: `${h.symbol || 'Stock'} (${a.label || 'Stock account'})` }))
      : []
  ))
  const selected = holdings.some(h => h.id === rsu.holdingId) ? rsu.holdingId : holdings[0]?.id
  const firstVest = simulation.rows.flatMap(row => row.rsuAwards.filter(a => a.incomeId === income.id).map(award => ({ year: row.year, award })))[0]
  const shares = (n: number) => Math.round(n).toLocaleString('en-CA')

  return (
    <div className="space-y-4 border-t border-border pt-5">
      {holdings.length === 0 ? (
        <Callout tone="warning" title="No stock to follow yet">
          Add the stock as a holding under Savings to turn this value into shares at its projected price. Until then, the after-tax value goes to a non-registered account.
        </Callout>
      ) : (
        <Field label="Stock" hint="The share count follows this holding's projected price in your selected bear, base or bull case.">
          <Select value={selected} onChange={(e) => update({ holdingId: e.target.value })}>
            {holdings.map(h => <option key={h.id} value={h.id}>{h.label}</option>)}
          </Select>
        </Field>
      )}
      <Checkbox
        checked={rsu.sellToCover}
        onChange={(sellToCover) => update({ sellToCover })}
        label="Sell shares at vesting to pay the tax"
        description="Keeps only the after-tax shares. Off keeps every share and pays the tax from cash."
      />
      {firstVest && (
        <p className="text-sm text-fg-secondary">
          {firstVest.year}: {money(firstVest.award.value)} at about {money(firstVest.award.price)} a share is {shares(firstVest.award.shares)} shares
          {rsu.sellToCover && <>, about {shares(firstVest.award.sharesKept)} after tax</>}. Future Canadian dollars.
        </p>
      )}
      <p className="text-xs text-fg-muted">
        Counts as employment income in the year it vests. If you also listed these vests as tranches on the holding, remove them so they aren't counted twice.
      </p>
    </div>
  )
}
