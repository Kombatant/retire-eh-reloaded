import { useState } from 'react'
import { Gift, Receipt, Trash2 } from 'lucide-react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { useProjectionContext } from '@/contexts/ProjectionContext'
import { useDetailLevel } from '@/hooks/useDetailLevel'
import {
  addExpenseItem, addExpensePhase, patchExpenseItem, patchExpensePhase, patchExpenses, removeExpenseItem,
  removeExpensePhase, setExpenseMode,
} from '@/lib/plan/edits'
import { GIFT_CATEGORY, type ExpenseItem } from '@/lib/plan/schema'
import { youngestPerson } from '@/lib/plan/time'
import { describeTimePoint } from '@/lib/plan/timeLabels'
import { newId } from '@/lib/plan/ids'
import { money } from '@/lib/formatting'
import { Card, CardHeader } from '@/components/ui/Card'
import { ListFrame, ListRow } from '@/components/ui/ListRow'
import { AddMenu } from '@/components/ui/AddMenu'
import { Sheet } from '@/components/ui/Sheet'
import { Field } from '@/components/ui/Field'
import { PercentInput, Select, TextInput } from '@/components/ui/inputs'
import { NumberInput } from '@/components/ui/NumberInput'
import { IntegerInput } from '@/components/ui/IntegerInput'
import { TimePointPicker } from '@/components/ui/TimePointPicker'
import { Checkbox } from '@/components/ui/Checkbox'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { IconButton } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Advanced } from '@/components/ui/Advanced'

function annualAmount(item: ExpenseItem): number {
  if (item.frequency === 'monthly') return item.amount * 12
  if (item.frequency === 'everyNYears') return item.amount / (item.everyNYears ?? 1)
  return item.amount
}

const FREQUENCY_LABEL: Record<ExpenseItem['frequency'], string> = {
  annual: 'per year',
  monthly: 'per month',
  everyNYears: 'every few years',
  oneTime: 'once',
}

export function SpendingSection() {
  const { activePlan, updateActivePlan } = usePlanStore()
  const { compiledPlan } = useProjectionContext()
  const [editingId, setEditingId] = useState<string | null>(null)
  const expenses = activePlan.expenses
  const detailed = expenses.mode === 'detailed'
  const anchorId = youngestPerson(activePlan.people)?.id ?? activePlan.people[0].id
  const recurring = expenses.items.filter(i => i.frequency !== 'oneTime')
  const oneTime = expenses.items.filter(i => i.frequency === 'oneTime')
  const editing = expenses.items.find(i => i.id === editingId) ?? null
  const annualTotal = recurring.reduce((s, i) => s + annualAmount(i), 0)

  const addRecurring = () => {
    const id = newId('expense')
    updateActivePlan(p => addExpenseItem(p, { id, label: 'New expense', category: 'general', amount: 5000, frequency: 'annual', essential: true, indexed: true, realGrowthPct: 0 }))
    setEditingId(id)
  }
  const addOneTime = () => {
    const id = newId('expense')
    updateActivePlan(p => addExpenseItem(p, {
      id, label: 'Gift to kids', category: GIFT_CATEGORY, amount: 50000,
      frequency: 'oneTime', from: { kind: 'age', personId: anchorId, age: 65 }, essential: false, indexed: true, realGrowthPct: 0,
    }))
    setEditingId(id)
  }

  const rowFor = (item: ExpenseItem) => (
    <ListRow
      key={item.id}
      leading={item.frequency === 'oneTime' ? undefined : <Badge tone={item.essential ? 'neutral' : 'accent'}>{item.essential ? 'Essential' : 'Flexible'}</Badge>}
      title={item.label || 'Expense'}
      subtitle={item.frequency === 'oneTime'
        ? describeTimePoint(item.from, activePlan.people, 'Now')
        : `${describeTimePoint(item.from, activePlan.people, 'Now')} → ${describeTimePoint(item.to, activePlan.people, 'End of plan')}`}
      value={money(item.amount)}
      valueSub={`${item.frequency === 'everyNYears' ? `every ${item.everyNYears ?? 1} yrs` : FREQUENCY_LABEL[item.frequency]}${item.frequency !== 'oneTime' && !item.indexed ? ', fixed $' : ''}`}
      onOpen={() => setEditingId(item.id)}
      openLabel={`Edit ${item.label}`}
      onRemove={() => updateActivePlan(p => removeExpenseItem(p, item.id))}
      removeLabel={`Remove ${item.label}`}
    />
  )

  return (
    <>
      <Card>
        <CardHeader
          title="Retirement spending"
          description={detailed ? 'Your budget, item by item.' : 'A quick target based on your salary before retirement.'}
          actions={
            <SegmentedControl
              ariaLabel="Spending mode"
              value={expenses.mode}
              onChange={(mode) => updateActivePlan(p => setExpenseMode(p, mode, compiledPlan.simpleSpendingTarget))}
              options={[{ value: 'simple', label: 'Simple' }, { value: 'detailed', label: 'Detailed budget' }]}
            />
          }
        />

        {!detailed ? (
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
            <Field
              label="Income target (% of final salary)"
              info="Aim for this share of your pre-retirement salary as pre-tax income in retirement. 60–80% is a common range. Switch to a detailed budget to plan actual expenses."
              className="w-56"
            >
              <PercentInput value={expenses.replacementRate} min={0} max={200} onChange={(v) => updateActivePlan(p => patchExpenses(p, { replacementRate: v }))} />
            </Field>
            <p className="pb-2.5 text-sm text-fg-secondary">
              ≈ <span className="font-semibold text-fg">{money(compiledPlan.simpleSpendingTarget)}</span> a year in today's dollars
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-fg-secondary">
                Recurring: <span className="font-semibold text-fg">{money(annualTotal)}</span> a year
              </p>
              <AddMenu label="Add expense" onAdd={addRecurring} />
            </div>
            {recurring.length === 0
              ? <EmptyState icon={Receipt} title="No expenses yet" description="Add your main costs: housing, food, transport, travel." />
              : <ListFrame>{recurring.map(rowFor)}</ListFrame>}
            <Advanced>
              <Checkbox
                checked={expenses.surplusPolicy === 'save'}
                onChange={(on) => updateActivePlan(p => patchExpenses(p, { surplusPolicy: on ? 'save' : 'ignore' }))}
                label="Invest cash left over after spending"
                description="Income left after tax, contributions and spending goes to a non-registered account. Off is more cautious."
              />
            </Advanced>
          </div>
        )}
      </Card>

      {detailed && (
        <Advanced>
          <PhasesCard anchorId={anchorId} />
        </Advanced>
      )}

      <Card>
        <CardHeader
          title="One-time expenses"
          description={detailed
            ? 'Large one-off costs, such as a car, a renovation or a gift, paid in the year they happen.'
            : 'Large one-off costs, such as gifts to children. In simple mode they are set aside from savings at retirement.'}
          actions={<AddMenu label="Add one-time" onAdd={addOneTime} />}
        />
        {oneTime.length === 0
          ? <EmptyState icon={Gift} title="None planned" />
          : <ListFrame>{oneTime.map(rowFor)}</ListFrame>}
      </Card>

      <Sheet open={editing !== null} onClose={() => setEditingId(null)} title={editing?.label || 'Expense'}>
        {editing && <ExpenseEditor item={editing} anchorId={anchorId} />}
      </Sheet>
    </>
  )
}

function ExpenseEditor({ item, anchorId }: { item: ExpenseItem; anchorId: string }) {
  const { activePlan, updateActivePlan, nowYear } = usePlanStore()
  const { isAdvanced } = useDetailLevel()
  const patch = (p: Partial<ExpenseItem>) => updateActivePlan(plan => patchExpenseItem(plan, item.id, p))
  const oneTime = item.frequency === 'oneTime'
  const fixedDollars = !oneTime && !item.indexed

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="What" className="sm:col-span-2">
          <TextInput value={item.label} onChange={(e) => patch({ label: e.target.value })} />
        </Field>
        <Field label="Amount" hint={fixedDollars ? 'The exact dollars you will pay each time.' : "In today's dollars."}>
          <NumberInput value={item.amount} min={0} onChange={(v) => patch({ amount: v })} />
        </Field>
        {!oneTime && (
          <Field label="How often">
            <Select
              value={item.frequency}
              onChange={(e) => patch({
                frequency: e.target.value as ExpenseItem['frequency'],
                everyNYears: e.target.value === 'everyNYears' ? (item.everyNYears ?? 10) : item.everyNYears,
              })}
            >
              <option value="annual">Every year</option>
              <option value="monthly">Every month</option>
              {(isAdvanced || item.frequency === 'everyNYears') && <option value="everyNYears">Every few years</option>}
            </Select>
          </Field>
        )}
        {item.frequency === 'everyNYears' && (
          <Field label="Every how many years">
            <IntegerInput value={item.everyNYears ?? 10} min={1} max={50} onChange={(v) => patch({ everyNYears: v })} />
          </Field>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 border-t border-border pt-5">
        <Field label={oneTime ? 'When' : 'From'}>
          <TimePointPicker value={item.from} onChange={(v) => patch({ from: v })} personId={anchorId} unsetLabel="Now" currentYear={nowYear} />
        </Field>
        {!oneTime && (
          <Field label="Until">
            <TimePointPicker value={item.to} onChange={(v) => patch({ to: v })} personId={anchorId} unsetLabel="End of plan" currentYear={nowYear} />
          </Field>
        )}
      </div>

      {!oneTime && (
        <div className="space-y-4 border-t border-border pt-5">
          <Checkbox
            checked={item.essential}
            onChange={(on) => patch({ essential: on })}
            label="Essential"
            description="Essential spending is never cut by flexible withdrawal strategies."
          />
          <Checkbox
            checked={item.indexed}
            onChange={(on) => patch({ indexed: on })}
            label="Adjust for inflation"
            description="The cost rises with inflation each year. Turn off for costs that stay at the same dollar amount, such as a fixed-rate payment."
          />
          {fixedDollars && activePlan.drawdown.strategy.kind !== 'expenses' && (
            <p className="text-xs text-fg-muted">Retirement withdrawals follow your withdrawal strategy. To have them follow this budget, choose "Fund my spending" under Withdrawals.</p>
          )}
          <Advanced>
            <Field
              label={item.indexed ? 'Growth above inflation' : 'Yearly increase'}
              info={item.indexed ? 'For costs that rise faster than prices in general, such as health care (1–2%).' : 'A set yearly change in this cost, in place of inflation.'}
              className="w-48"
            >
              <PercentInput value={item.realGrowthPct} onChange={(v) => patch({ realGrowthPct: v })} />
            </Field>
          </Advanced>
        </div>
      )}
    </div>
  )
}

function PhasesCard({ anchorId }: { anchorId: string }) {
  const { activePlan, updateActivePlan, nowYear } = usePlanStore()
  const phases = activePlan.expenses.phases
  return (
    <Card>
      <CardHeader
        title="Spending phases"
        description="Scale flexible spending through retirement, e.g. 120% in the active early years and 70% later on."
        actions={
          <AddMenu
            label="Add phase"
            onAdd={() => updateActivePlan(p => addExpensePhase(p, {
              id: newId('phase'), name: 'Slow-go years', from: { kind: 'age', personId: anchorId, age: 75 }, discretionaryMultiplierPct: 70,
            }))}
          />
        }
      />
      {phases.length === 0 ? (
        <p className="text-sm text-fg-muted">No phases: flexible spending stays at 100% throughout.</p>
      ) : (
        <div className="space-y-3">
          {phases.map(phase => (
            <div key={phase.id} className="grid grid-cols-1 items-end gap-3 rounded-lg border border-border p-3 sm:grid-cols-[1fr_1.4fr_8rem_auto]">
              <Field label="Name">
                <TextInput value={phase.name} onChange={(e) => updateActivePlan(p => patchExpensePhase(p, phase.id, { name: e.target.value }))} />
              </Field>
              <Field label="Starts">
                <TimePointPicker value={phase.from} onChange={(v) => v && updateActivePlan(p => patchExpensePhase(p, phase.id, { from: v }))} personId={anchorId} currentYear={nowYear} />
              </Field>
              <Field label="Flexible spending">
                <PercentInput value={phase.discretionaryMultiplierPct} min={0} max={300} onChange={(v) => updateActivePlan(p => patchExpensePhase(p, phase.id, { discretionaryMultiplierPct: v }))} />
              </Field>
              <IconButton icon={Trash2} label={`Remove ${phase.name}`} onClick={() => updateActivePlan(p => removeExpensePhase(p, phase.id))} className="text-fg-muted hover:text-danger" />
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
