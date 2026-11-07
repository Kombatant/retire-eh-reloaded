import { ShoppingBasket, X } from 'lucide-react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { useProjectionContext } from '@/contexts/ProjectionContext'
import {
  addExpenseItem,
  addExpensePhase,
  patchExpenseItem,
  patchExpensePhase,
  patchExpenses,
  removeExpenseItem,
  removeExpensePhase,
  setExpenseMode,
} from '@/lib/plan/edits'
import { GIFT_CATEGORY, type ExpenseItem } from '@/lib/plan/schema'
import { youngestPerson } from '@/lib/plan/time'
import { newId } from '@/lib/plan/ids'
import { formatMoney } from '@/lib/formatting'
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

function ModeToggle({ value, onChange }: { value: 'simple' | 'detailed'; onChange: (v: 'simple' | 'detailed') => void }) {
  return (
    <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 p-0.5 text-xs" role="radiogroup" aria-label="Spending mode">
      {(['simple', 'detailed'] as const).map(mode => (
        <button
          key={mode}
          role="radio"
          aria-checked={value === mode}
          onClick={() => onChange(mode)}
          className={`px-3 py-1 rounded-md min-h-[28px] ${value === mode ? 'bg-indigo-500 text-white' : 'text-gray-600 dark:text-gray-300'}`}
        >
          {mode === 'simple' ? 'Simple' : 'Detailed budget'}
        </button>
      ))}
    </div>
  )
}

export function SpendingPanel() {
  const { activePlan, updateActivePlan, nowYear } = usePlanStore()
  const { compiledPlan } = useProjectionContext()
  const expenses = activePlan.expenses
  const detailed = expenses.mode === 'detailed'
  const anchorId = youngestPerson(activePlan.people)?.id ?? activePlan.people[0].id
  const recurring = expenses.items.filter(i => i.frequency !== 'oneTime')
  const oneTime = expenses.items.filter(i => i.frequency === 'oneTime')

  const patchItem = (id: string, patch: Partial<ExpenseItem>) => updateActivePlan(p => patchExpenseItem(p, id, patch))
  const annualTotal = recurring.reduce((s, i) => s + (i.frequency === 'monthly' ? i.amount * 12 : i.frequency === 'everyNYears' ? i.amount / (i.everyNYears ?? 1) : i.amount), 0)

  return (
    <div className="animate-fade-in-up card p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-white">
          <ShoppingBasket className="w-4 h-4 text-rose-500" />
          Spending
        </h2>
        <ModeToggle value={expenses.mode} onChange={(mode) => updateActivePlan(p => setExpenseMode(p, mode, compiledPlan.simpleSpendingTarget))} />
      </div>

      {!detailed ? (
        <label className="block">
          <span className={labelClass}>
            Retirement income target (% of final salary)
            <InfoTooltip text="Simple mode: aim for this share of your pre-retirement salary as pre-tax income in retirement. Switch to a detailed budget to plan actual expenses, including mortgage and home costs." />
          </span>
          <input
            type="number"
            min={0}
            max={200}
            step={5}
            value={expenses.replacementRate}
            onChange={(e) => {
              const v = parseFloat(e.target.value)
              if (Number.isFinite(v)) updateActivePlan(p => patchExpenses(p, { replacementRate: v }))
            }}
            className={`${inputClass} w-28`}
          />
          <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
            ≈ ${formatMoney(compiledPlan.simpleSpendingTarget)}/yr in today's dollars
          </span>
        </label>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
              Recurring expenses · ${formatMoney(annualTotal)}/yr
            </span>
            <button
              onClick={() => updateActivePlan(p => addExpenseItem(p, {
                id: newId('expense'), label: 'New expense', category: 'general', amount: 5000,
                frequency: 'annual', essential: true, realGrowthPct: 0,
              }))}
              className="text-xs text-indigo-600 dark:text-indigo-400 font-medium min-h-[28px]"
            >
              + Add expense
            </button>
          </div>
          {recurring.map(item => (
            <div key={item.id} className={rowClass}>
              <div className="flex items-center gap-2">
                <input value={item.label} onChange={(e) => patchItem(item.id, { label: e.target.value })} className="flex-1 min-w-0 bg-transparent text-sm text-gray-800 dark:text-gray-200 focus:outline-none" aria-label="Expense name" />
                <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300" title="Essential spending is never cut by flexible withdrawal strategies.">
                  <input type="checkbox" checked={item.essential} onChange={(e) => patchItem(item.id, { essential: e.target.checked })} className="accent-indigo-500" />
                  Essential
                </label>
                <RemoveButton onClick={() => updateActivePlan(p => removeExpenseItem(p, item.id))} label="Remove expense" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <label>
                  <span className={labelClass}>Amount</span>
                  <NumberInput value={item.amount} onChange={(v) => patchItem(item.id, { amount: v })} step={500} min={0} ariaLabel="Expense amount" />
                </label>
                <label>
                  <span className={labelClass}>How often</span>
                  <select
                    value={item.frequency}
                    onChange={(e) => patchItem(item.id, {
                      frequency: e.target.value as ExpenseItem['frequency'],
                      everyNYears: e.target.value === 'everyNYears' ? (item.everyNYears ?? 10) : item.everyNYears,
                    })}
                    className={inputClass}
                  >
                    <option value="annual">Yearly</option>
                    <option value="monthly">Monthly</option>
                    <option value="everyNYears">Every N years</option>
                  </select>
                </label>
                {item.frequency === 'everyNYears' ? (
                  <label>
                    <span className={labelClass}>Every (years)</span>
                    <input type="number" min={1} max={50} value={item.everyNYears ?? 10} onChange={(e) => patchItem(item.id, { everyNYears: Math.max(1, parseInt(e.target.value, 10) || 1) })} className={inputClass} />
                  </label>
                ) : (
                  <label>
                    <span className={labelClass}>
                      Real growth %
                      <InfoTooltip text="Growth above inflation, e.g. 1–2% for health care costs that rise faster than prices." />
                    </span>
                    <input type="number" step={0.5} value={item.realGrowthPct} onChange={(e) => patchItem(item.id, { realGrowthPct: parseFloat(e.target.value) || 0 })} className={inputClass} />
                  </label>
                )}
                <div className="col-span-2 sm:col-span-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <span className={labelClass}>From</span>
                    <TimePointPicker value={item.from} onChange={(v) => patchItem(item.id, { from: v })} personId={anchorId} unsetLabel="Now" currentYear={nowYear} ariaLabel="Expense start" />
                  </div>
                  <div>
                    <span className={labelClass}>Until</span>
                    <TimePointPicker value={item.to} onChange={(v) => patchItem(item.id, { to: v })} personId={anchorId} unsetLabel="End of plan" currentYear={nowYear} ariaLabel="Expense end" />
                  </div>
                </div>
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between pt-1">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
              Spending phases
              <InfoTooltip text="Scale non-essential spending in stages of retirement, e.g. 120% in the active early years and 70% later." />
            </span>
            <button
              onClick={() => updateActivePlan(p => addExpensePhase(p, {
                id: newId('phase'), name: 'Slow-go years', from: { kind: 'age', personId: anchorId, age: 75 }, discretionaryMultiplierPct: 70,
              }))}
              className="text-xs text-indigo-600 dark:text-indigo-400 font-medium min-h-[28px]"
            >
              + Add phase
            </button>
          </div>
          {expenses.phases.map(phase => (
            <div key={phase.id} className={`${rowClass} grid grid-cols-1 sm:grid-cols-4 gap-2 items-end space-y-0`}>
              <label>
                <span className={labelClass}>Name</span>
                <input value={phase.name} onChange={(e) => updateActivePlan(p => patchExpensePhase(p, phase.id, { name: e.target.value }))} className={inputClass} />
              </label>
              <div>
                <span className={labelClass}>From</span>
                <TimePointPicker value={phase.from} onChange={(v) => v && updateActivePlan(p => patchExpensePhase(p, phase.id, { from: v }))} personId={anchorId} currentYear={nowYear} ariaLabel="Phase start" />
              </div>
              <label>
                <span className={labelClass}>Non-essential spending %</span>
                <input type="number" min={0} max={300} step={5} value={phase.discretionaryMultiplierPct} onChange={(e) => updateActivePlan(p => patchExpensePhase(p, phase.id, { discretionaryMultiplierPct: parseFloat(e.target.value) || 0 }))} className={inputClass} />
              </label>
              <div className="flex justify-end">
                <RemoveButton onClick={() => updateActivePlan(p => removeExpensePhase(p, phase.id))} label="Remove phase" />
              </div>
            </div>
          ))}

          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
            <input
              type="checkbox"
              checked={expenses.surplusPolicy === 'save'}
              onChange={(e) => updateActivePlan(p => patchExpenses(p, { surplusPolicy: e.target.checked ? 'save' : 'ignore' }))}
              className="accent-indigo-500"
            />
            Invest cash left over after spending and contributions
            <InfoTooltip text="When on, any income left after tax, contributions and spending is added to a non-registered account. Leave off to be conservative. Shortfalls are always drawn from your savings." />
          </label>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
            One-time expenses
            <InfoTooltip text={detailed ? 'Large one-off costs (a car, a renovation, a gift to children) paid in the year they happen.' : 'Large one-off costs such as gifts to children. In simple mode they are set aside from the portfolio when you retire.'} />
          </span>
          <button
            onClick={() => updateActivePlan(p => addExpenseItem(p, {
              id: newId('expense'), label: 'Gift to kids', category: GIFT_CATEGORY, amount: 50000,
              frequency: 'oneTime', from: { kind: 'age', personId: anchorId, age: 65 }, essential: false, realGrowthPct: 0,
            }))}
            className="text-xs text-indigo-600 dark:text-indigo-400 font-medium min-h-[28px]"
          >
            + Add one-time
          </button>
        </div>
        {oneTime.map(item => (
          <div key={item.id} className={`${rowClass} grid grid-cols-1 sm:grid-cols-[1fr_8rem_1fr_auto] gap-2 items-end space-y-0`}>
            <label>
              <span className={labelClass}>What</span>
              <input value={item.label} onChange={(e) => patchItem(item.id, { label: e.target.value })} className={inputClass} />
            </label>
            <label>
              <span className={labelClass}>Amount</span>
              <NumberInput value={item.amount} onChange={(v) => patchItem(item.id, { amount: v })} step={1000} min={0} ariaLabel="One-time amount" />
            </label>
            <div>
              <span className={labelClass}>When</span>
              <TimePointPicker value={item.from} onChange={(v) => patchItem(item.id, { from: v })} personId={anchorId} unsetLabel="Now" currentYear={nowYear} ariaLabel="When" />
            </div>
            <RemoveButton onClick={() => updateActivePlan(p => removeExpenseItem(p, item.id))} label="Remove one-time expense" />
          </div>
        ))}
      </div>

    </div>
  )
}
