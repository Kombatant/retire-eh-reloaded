import { useState } from 'react'
import { CreditCard, Home } from 'lucide-react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { addDebt, addProperty, patchDebt, patchProperty, removeDebt, removeProperty } from '@/lib/plan/edits'
import type { Debt, Property } from '@/lib/plan/schema'
import { newId } from '@/lib/plan/ids'
import { monthsToRepay } from '@/lib/sim/steps/debts'
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
import { Checkbox } from '@/components/ui/Checkbox'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'

function payoffLabel(debt: Debt, nowYear: number): string {
  if (debt.balance <= 0) return 'Paid off'
  const months = monthsToRepay(debt.balance, debt.interestRatePct / 100, debt.monthlyPayment)
  if (!Number.isFinite(months)) return 'Payment does not cover the interest'
  return `Paid off in ${nowYear + Math.ceil(months / 12)} (${Math.floor(months / 12)} yr ${months % 12} mo)`
}

type Editing = { kind: 'property' | 'debt'; id: string } | null

export function PropertySection() {
  const { activePlan, updateActivePlan, nowYear } = usePlanStore()
  const [editing, setEditing] = useState<Editing>(null)
  const property = editing?.kind === 'property' ? activePlan.properties.find(p => p.id === editing.id) : undefined
  const debt = editing?.kind === 'debt' ? activePlan.debts.find(d => d.id === editing.id) : undefined

  const newProperty = () => {
    const id = newId('property')
    updateActivePlan(p => addProperty(p, {
      id, ownerId: 'joint', label: 'Home', value: 600000, appreciationRealPct: 0, isPrincipalResidence: true, annualCosts: 6000,
    }))
    setEditing({ kind: 'property', id })
  }
  const newDebt = () => {
    const id = newId('debt')
    updateActivePlan(p => addDebt(p, {
      id, label: 'Mortgage', kind: 'mortgage', balance: 300000, interestRatePct: 4.5, monthlyPayment: 1700, propertyId: p.properties[0]?.id,
    }))
    setEditing({ kind: 'debt', id })
  }

  return (
    <>
      <Card>
        <CardHeader
          title="Real estate"
          description="Homes and other property. Counted in net worth, and you can plan a sale or downsize."
          actions={<AddMenu label="Add property" onAdd={newProperty} />}
        />
        {activePlan.properties.length === 0 ? (
          <EmptyState icon={Home} title="No property" description="Add your home to include its equity and a possible downsize." />
        ) : (
          <ListFrame>
            {activePlan.properties.map(prop => (
              <ListRow
                key={prop.id}
                leading={prop.isPrincipalResidence ? <Badge>Principal residence</Badge> : <Badge>Property</Badge>}
                title={prop.label || 'Property'}
                subtitle={prop.sale ? `${prop.sale.replacementValue > 0 ? 'Downsize' : 'Sell'}: ${describeTimePoint(prop.sale.at, activePlan.people, '')}` : 'Kept for the whole plan'}
                value={money(prop.value)}
                onOpen={() => setEditing({ kind: 'property', id: prop.id })}
                openLabel={`Edit ${prop.label}`}
                onRemove={() => updateActivePlan(p => removeProperty(p, prop.id))}
                removeLabel={`Remove ${prop.label}`}
              />
            ))}
          </ListFrame>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Debts"
          description="Mortgages and loans are paid down from your income each month until they are gone."
          actions={<AddMenu label="Add debt" onAdd={newDebt} />}
        />
        {activePlan.debts.length === 0 ? (
          <EmptyState icon={CreditCard} title="No debts" />
        ) : (
          <ListFrame>
            {activePlan.debts.map(d => (
              <ListRow
                key={d.id}
                title={d.label || 'Debt'}
                subtitle={payoffLabel(d, nowYear)}
                value={money(d.balance)}
                valueSub={`${money(d.monthlyPayment)}/mo · ${d.interestRatePct}%`}
                onOpen={() => setEditing({ kind: 'debt', id: d.id })}
                openLabel={`Edit ${d.label}`}
                onRemove={() => updateActivePlan(p => removeDebt(p, d.id))}
                removeLabel={`Remove ${d.label}`}
              />
            ))}
          </ListFrame>
        )}
      </Card>

      <Sheet open={!!property} onClose={() => setEditing(null)} title={property?.label || 'Property'}>
        {property && <PropertyEditor prop={property} />}
      </Sheet>
      <Sheet open={!!debt} onClose={() => setEditing(null)} title={debt?.label || 'Debt'} description={debt ? payoffLabel(debt, nowYear) : undefined}>
        {debt && <DebtEditor debt={debt} />}
      </Sheet>
    </>
  )
}

function PropertyEditor({ prop }: { prop: Property }) {
  const { activePlan, updateActivePlan, nowYear } = usePlanStore()
  const update = (patch: Partial<Property>) => updateActivePlan(p => patchProperty(p, prop.id, patch))
  const anchor = prop.ownerId === 'joint' ? activePlan.people[0].id : prop.ownerId

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">
          <TextInput value={prop.label} onChange={(e) => update({ label: e.target.value })} />
        </Field>
        <Field label="Value today">
          <NumberInput value={prop.value} min={0} onChange={(v) => update({ value: v })} />
        </Field>
        <Field label="Yearly costs" info="Property tax, insurance and maintenance. Counted as spending in a detailed budget.">
          <NumberInput value={prop.annualCosts} min={0} onChange={(v) => update({ annualCosts: v })} />
        </Field>
        <Field label="Growth above inflation" info="Long-run appreciation after inflation. 0% means the home keeps pace with prices.">
          <PercentInput value={prop.appreciationRealPct} onChange={(v) => update({ appreciationRealPct: v })} />
        </Field>
        {!prop.isPrincipalResidence && (
          <Field label="Cost base" info="What you paid, plus improvements. The gain over this is taxed when sold.">
            <NumberInput value={prop.acb ?? prop.value} min={0} onChange={(v) => update({ acb: v })} />
          </Field>
        )}
      </div>
      <Checkbox
        checked={prop.isPrincipalResidence}
        onChange={(on) => update({ isPrincipalResidence: on })}
        label="Principal residence"
        description="Exempt from capital gains tax when sold."
      />
      <div className="space-y-4 border-t border-border pt-5">
        <Checkbox
          checked={prop.sale !== undefined}
          onChange={(on) => update({ sale: on ? { at: { kind: 'age', personId: anchor, age: 75 }, sellingCostPct: 5, replacementValue: 0 } : undefined })}
          label="Sell or downsize"
          description="What is left after the mortgage and any next home is invested for your retirement and counts toward your goal."
        />
        {prop.sale && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="When" className="sm:col-span-2">
              <TimePointPicker value={prop.sale.at} onChange={(v) => v && update({ sale: { ...prop.sale!, at: v } })} personId={anchor} currentYear={nowYear} />
            </Field>
            <Field label="Selling costs">
              <PercentInput value={prop.sale.sellingCostPct} min={0} max={20} onChange={(v) => update({ sale: { ...prop.sale!, sellingCostPct: v } })} />
            </Field>
            <Field label="Next home's value" info="Today's dollars. Leave at 0 to rent afterwards (add rent to your budget). The rest of the proceeds is invested.">
              <NumberInput value={prop.sale.replacementValue} min={0} onChange={(v) => update({ sale: { ...prop.sale!, replacementValue: v } })} />
            </Field>
          </div>
        )}
      </div>
    </div>
  )
}

function DebtEditor({ debt }: { debt: Debt }) {
  const { activePlan, updateActivePlan } = usePlanStore()
  const update = (patch: Partial<Debt>) => updateActivePlan(p => patchDebt(p, debt.id, patch))
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Name" className="sm:col-span-2">
        <TextInput value={debt.label} onChange={(e) => update({ label: e.target.value })} />
      </Field>
      <Field label="Balance owed">
        <NumberInput value={debt.balance} min={0} onChange={(v) => update({ balance: v })} />
      </Field>
      <Field label="Interest rate">
        <PercentInput value={debt.interestRatePct} min={0} max={40} onChange={(v) => update({ interestRatePct: v })} />
      </Field>
      <Field label="Monthly payment">
        <NumberInput value={debt.monthlyPayment} min={0} onChange={(v) => update({ monthlyPayment: v })} />
      </Field>
      <Field label="Secured by" info="A mortgage linked to a property is repaid from the sale proceeds if you sell.">
        <Select value={debt.propertyId ?? ''} onChange={(e) => update({ propertyId: e.target.value || undefined })}>
          <option value="">Unsecured</option>
          {activePlan.properties.map(p => <option key={p.id} value={p.id}>{p.label || 'Property'}</option>)}
        </Select>
      </Field>
    </div>
  )
}
