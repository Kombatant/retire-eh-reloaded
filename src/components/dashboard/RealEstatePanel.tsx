import { Home, X } from 'lucide-react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { addDebt, addProperty, patchDebt, patchProperty, removeDebt, removeProperty } from '@/lib/plan/edits'
import type { Debt, Property } from '@/lib/plan/schema'
import { newId } from '@/lib/plan/ids'
import { monthsToRepay } from '@/lib/sim/steps/debts'
import { NumberInput } from '@/components/ui/NumberInput'
import { TimePointPicker } from '@/components/ui/TimePointPicker'
import { InfoTooltip } from './InfoTooltip'

const labelClass = 'block text-xs text-gray-500 dark:text-gray-400 mb-1'
const inputClass = 'w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20'
const rowClass = 'rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 p-2.5 space-y-2'

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className="p-1 text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400" aria-label={label} title={label}>
      <X className="w-4 h-4" />
    </button>
  )
}

function payoffLabel(debt: Debt, nowYear: number): string {
  const months = monthsToRepay(debt.balance, debt.interestRatePct / 100, debt.monthlyPayment)
  if (debt.balance <= 0) return 'Paid off'
  if (!Number.isFinite(months)) return 'Payment does not cover the interest'
  return `Paid off in ${Math.floor(months / 12)} yr ${months % 12} mo (${nowYear + Math.ceil(months / 12)})`
}

export function RealEstatePanel() {
  const { activePlan, updateActivePlan, nowYear } = usePlanStore()
  const ownerId = activePlan.people[0].id
  const updateProperty = (id: string, patch: Partial<Property>) => updateActivePlan(p => patchProperty(p, id, patch))
  const updateDebt = (id: string, patch: Partial<Debt>) => updateActivePlan(p => patchDebt(p, id, patch))

  return (
    <div className="animate-fade-in-up card p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-white">
          <Home className="w-4 h-4 text-teal-500" />
          Real estate &amp; debts
        </h2>
        <div className="flex gap-3">
          <button
            onClick={() => updateActivePlan(p => addProperty(p, {
              id: newId('property'), ownerId: 'joint', label: 'Home', value: 600000, appreciationRealPct: 0,
              isPrincipalResidence: true, annualCosts: 6000,
            }))}
            className="text-xs text-indigo-600 dark:text-indigo-400 font-medium min-h-[28px]"
          >
            + Add property
          </button>
          <button
            onClick={() => updateActivePlan(p => addDebt(p, {
              id: newId('debt'), label: 'Mortgage', kind: 'mortgage', balance: 300000, interestRatePct: 4.5, monthlyPayment: 1700,
              propertyId: p.properties[0]?.id,
            }))}
            className="text-xs text-indigo-600 dark:text-indigo-400 font-medium min-h-[28px]"
          >
            + Add debt
          </button>
        </div>
      </div>

      {activePlan.properties.length === 0 && activePlan.debts.length === 0 && (
        <p className="text-xs text-gray-400 dark:text-gray-500 italic">
          Add your home and any mortgage or loans to include home equity in net worth and plan a downsize.
        </p>
      )}

      {activePlan.properties.map(prop => (
        <div key={prop.id} className={rowClass}>
          <div className="flex items-center gap-2">
            <input value={prop.label} onChange={(e) => updateProperty(prop.id, { label: e.target.value })} className="flex-1 min-w-0 bg-transparent text-sm font-medium text-gray-800 dark:text-gray-200 focus:outline-none" aria-label="Property name" />
            <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300" title="A principal residence is exempt from capital gains tax when sold.">
              <input type="checkbox" checked={prop.isPrincipalResidence} onChange={(e) => updateProperty(prop.id, { isPrincipalResidence: e.target.checked })} className="accent-indigo-500" />
              Principal residence
            </label>
            <RemoveButton onClick={() => updateActivePlan(p => removeProperty(p, prop.id))} label="Remove property" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <label>
              <span className={labelClass}>Value today</span>
              <NumberInput value={prop.value} onChange={(v) => updateProperty(prop.id, { value: v })} step={10000} min={0} ariaLabel="Property value" />
            </label>
            <label>
              <span className={labelClass}>
                Growth above inflation %
                <InfoTooltip text="Long-run real appreciation. 0% means the home keeps pace with inflation." />
              </span>
              <input type="number" step={0.5} value={prop.appreciationRealPct} onChange={(e) => updateProperty(prop.id, { appreciationRealPct: parseFloat(e.target.value) || 0 })} className={inputClass} />
            </label>
            <label>
              <span className={labelClass}>
                Yearly costs
                <InfoTooltip text="Property tax, insurance, maintenance. Counted as spending in a detailed budget." />
              </span>
              <NumberInput value={prop.annualCosts} onChange={(v) => updateProperty(prop.id, { annualCosts: v })} step={500} min={0} ariaLabel="Yearly property costs" />
            </label>
            {!prop.isPrincipalResidence && (
              <label>
                <span className={labelClass}>Cost base</span>
                <NumberInput value={prop.acb ?? prop.value} onChange={(v) => updateProperty(prop.id, { acb: v })} step={10000} min={0} ariaLabel="Property cost base" />
              </label>
            )}
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
            <input
              type="checkbox"
              checked={prop.sale !== undefined}
              onChange={(e) => updateProperty(prop.id, {
                sale: e.target.checked ? { at: { kind: 'age', personId: ownerId, age: 75 }, sellingCostPct: 5, replacementValue: 0 } : undefined,
              })}
              className="accent-indigo-500"
            />
            Sell or downsize
          </label>
          {prop.sale && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <span className={labelClass}>When</span>
                <TimePointPicker
                  value={prop.sale.at}
                  onChange={(v) => v && updateProperty(prop.id, { sale: { ...prop.sale!, at: v } })}
                  personId={prop.ownerId === 'joint' ? ownerId : prop.ownerId}
                  currentYear={nowYear}
                  ariaLabel="Sale date"
                />
              </div>
              <label>
                <span className={labelClass}>Selling costs %</span>
                <input type="number" min={0} max={20} step={0.5} value={prop.sale.sellingCostPct} onChange={(e) => updateProperty(prop.id, { sale: { ...prop.sale!, sellingCostPct: parseFloat(e.target.value) || 0 } })} className={inputClass} />
              </label>
              <label>
                <span className={labelClass}>
                  Replacement home (today's $)
                  <InfoTooltip text="Value of the home you buy with the proceeds. Leave at 0 to rent afterwards (add rent to your budget). The rest of the proceeds is invested." />
                </span>
                <NumberInput value={prop.sale.replacementValue} onChange={(v) => updateProperty(prop.id, { sale: { ...prop.sale!, replacementValue: v } })} step={10000} min={0} ariaLabel="Replacement home value" />
              </label>
            </div>
          )}
        </div>
      ))}

      {activePlan.debts.map(debt => (
        <div key={debt.id} className={rowClass}>
          <div className="flex items-center gap-2">
            <input value={debt.label} onChange={(e) => updateDebt(debt.id, { label: e.target.value })} className="flex-1 min-w-0 bg-transparent text-sm font-medium text-gray-800 dark:text-gray-200 focus:outline-none" aria-label="Debt name" />
            <span className="text-[11px] text-gray-500 dark:text-gray-400">{payoffLabel(debt, nowYear)}</span>
            <RemoveButton onClick={() => updateActivePlan(p => removeDebt(p, debt.id))} label="Remove debt" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <label>
              <span className={labelClass}>Balance</span>
              <NumberInput value={debt.balance} onChange={(v) => updateDebt(debt.id, { balance: v })} step={1000} min={0} ariaLabel="Debt balance" />
            </label>
            <label>
              <span className={labelClass}>Interest %</span>
              <input type="number" min={0} max={40} step={0.1} value={debt.interestRatePct} onChange={(e) => updateDebt(debt.id, { interestRatePct: parseFloat(e.target.value) || 0 })} className={inputClass} />
            </label>
            <label>
              <span className={labelClass}>Monthly payment</span>
              <NumberInput value={debt.monthlyPayment} onChange={(v) => updateDebt(debt.id, { monthlyPayment: v })} step={50} min={0} ariaLabel="Monthly payment" />
            </label>
            <label>
              <span className={labelClass}>
                Secured by
                <InfoTooltip text="A mortgage linked to a property is repaid from the sale proceeds if you sell." />
              </span>
              <select value={debt.propertyId ?? ''} onChange={(e) => updateDebt(debt.id, { propertyId: e.target.value || undefined })} className={inputClass}>
                <option value="">Unsecured</option>
                {activePlan.properties.map(p => <option key={p.id} value={p.id}>{p.label || 'Property'}</option>)}
              </select>
            </label>
          </div>
        </div>
      ))}
    </div>
  )
}
