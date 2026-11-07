import { useState } from 'react'
import { Banknote, ChevronDown, ChevronRight, X } from 'lucide-react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { addIncome, newIncome, patchIncome, removeIncome, type IncomeTemplate } from '@/lib/plan/edits'
import type { IncomeStream } from '@/lib/plan/schema'
import { NumberInput } from '@/components/ui/NumberInput'
import { TimePointPicker } from '@/components/ui/TimePointPicker'
import { InfoTooltip } from './InfoTooltip'
import { DropdownMenu } from '@/components/ui/Floating'

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

const labelClass = 'block text-xs text-gray-500 dark:text-gray-400 mb-1'
const inputClass = 'w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20'

function IncomeEditor({ income }: { income: IncomeStream }) {
  const { activePlan, updateActivePlan, nowYear } = usePlanStore()
  const [open, setOpen] = useState(false)
  const update = (patch: Partial<IncomeStream>) => updateActivePlan(p => patchIncome(p, income.id, patch))
  const oneTime = income.frequency === 'oneTime'

  return (
    <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <span className="px-2 py-0.5 text-xs font-semibold rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
          {KIND_LABELS[income.kind]}
        </span>
        <input
          value={income.label}
          onChange={(e) => update({ label: e.target.value })}
          className="flex-1 min-w-0 bg-transparent text-sm text-gray-800 dark:text-gray-200 focus:outline-none"
          aria-label="Income label"
        />
        <button onClick={() => setOpen(!open)} className="flex items-center gap-0.5 text-xs text-indigo-600 dark:text-indigo-400 min-h-[28px]" aria-expanded={open}>
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          Details
        </button>
        <button
          onClick={() => updateActivePlan(p => removeIncome(p, income.id))}
          className="p-1 text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400"
          aria-label="Remove income"
          title="Remove income"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[8rem_1fr_1fr] gap-2">
        <label>
          <span className={labelClass}>{oneTime ? 'Amount' : 'Per year'}</span>
          <NumberInput value={income.amount} onChange={(v) => update({ amount: v })} step={1000} min={0} ariaLabel="Amount" />
        </label>
        <div>
          <span className={labelClass}>{oneTime ? 'Received' : 'Starts'}</span>
          <TimePointPicker
            value={income.from}
            onChange={(v) => update({ from: v })}
            personId={income.ownerId}
            unsetLabel="Now"
            currentYear={nowYear}
            ariaLabel="Start"
          />
        </div>
        {!oneTime && (
          <div>
            <span className={labelClass}>Ends</span>
            <TimePointPicker
              value={income.to}
              onChange={(v) => update({ to: v })}
              personId={income.ownerId}
              unsetLabel="End of plan"
              currentYear={nowYear}
              ariaLabel="End"
            />
          </div>
        )}
      </div>

      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
          <label>
            <span className={labelClass}>Person</span>
            <select value={income.ownerId} onChange={(e) => update({ ownerId: e.target.value })} className={inputClass}>
              {activePlan.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label>
            <span className={labelClass}>
              Growth
              <InfoTooltip text="Inflation-linked amounts keep their purchasing power (plus any real raise). Fixed grows by a set % each year. Flat stays the same dollar amount, so it shrinks in real terms." />
            </span>
            <div className="flex gap-1">
              <select
                value={income.growth.kind}
                onChange={(e) => update({ growth: { ...income.growth, kind: e.target.value as IncomeStream['growth']['kind'] } })}
                className={`${inputClass} flex-1`}
                aria-label="Growth rule"
              >
                <option value="cpi">Inflation +</option>
                <option value="fixed">Fixed</option>
                <option value="none">Flat</option>
              </select>
              {income.growth.kind !== 'none' && (
                <input
                  type="number"
                  step={0.5}
                  value={income.growth.pct}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value)
                    update({ growth: { ...income.growth, pct: Number.isFinite(v) ? v : 0 } })
                  }}
                  className={`${inputClass} w-16`}
                  aria-label="Growth %"
                  title="% per year"
                />
              )}
            </div>
          </label>
          <label>
            <span className={labelClass}>Tax treatment</span>
            <select
              value={income.taxTreatment}
              onChange={(e) => update({ taxTreatment: e.target.value as IncomeStream['taxTreatment'] })}
              className={inputClass}
            >
              <option value="ordinary">Taxable income</option>
              <option value="nonTaxable">Not taxable</option>
              <option value="capitalGain">Capital gain</option>
              <option value="eligibleDividend">Eligible dividend</option>
            </select>
          </label>

          {income.kind === 'dbPension' && (
            <>
              <label>
                <span className={labelClass}>
                  Indexed to inflation (%)
                  <InfoTooltip text="Share of each year's inflation the pension increases by once it is paid. Public-sector plans are often 100%; many private plans index partly or not at all." />
                </span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  value={income.db?.indexationPctOfCpi ?? 100}
                  onChange={(e) => update({ db: { survivorPct: 60, ...income.db, indexationPctOfCpi: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)) } })}
                  className={inputClass}
                />
              </label>
              <label>
                <span className={labelClass}>
                  Bridge benefit / yr
                  <InfoTooltip text="Extra pension paid from retirement until the bridge end age (usually 65), when CPP and OAS begin." />
                </span>
                <NumberInput
                  value={income.db?.bridge?.amount ?? 0}
                  onChange={(v) => update({
                    db: {
                      indexationPctOfCpi: 100, survivorPct: 60, ...income.db,
                      bridge: v > 0 ? { amount: v, untilAge: income.db?.bridge?.untilAge ?? 65 } : undefined,
                    },
                  })}
                  step={1000}
                  min={0}
                  ariaLabel="Bridge benefit"
                />
              </label>
              <label>
                <span className={labelClass}>
                  Survivor pension (%)
                  <InfoTooltip text="Share of the pension that continues to a surviving spouse." />
                </span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  value={income.db?.survivorPct ?? 60}
                  onChange={(e) => update({ db: { indexationPctOfCpi: 100, ...income.db, survivorPct: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)) } })}
                  className={inputClass}
                />
              </label>
            </>
          )}
          {oneTime && (
            <p className="sm:col-span-3 text-[11px] text-gray-500 dark:text-gray-400">
              One-time amounts are invested in a non-registered account in the year they are received.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export function IncomePanel() {
  const { activePlan, updateActivePlan, selectedPersonId } = usePlanStore()
  const ownerId = selectedPersonId ?? activePlan.people[0]?.id

  const add = (template: IncomeTemplate) => {
    if (!ownerId) return
    updateActivePlan(p => addIncome(p, newIncome(template, ownerId)))
  }

  return (
    <div className="animate-fade-in-up card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-white">
          <Banknote className="w-4 h-4 text-amber-500" />
          Income &amp; events
          <InfoTooltip text="Every income source in the plan: salaries (with raises), part-time work, sabbaticals (end a salary and start it again later), pensions, rental income, and one-time amounts such as an inheritance." />
        </h2>
        <DropdownMenu
          label="+ Add income"
          buttonClassName="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 font-medium min-h-[28px]"
          menuClassName="w-56"
          items={TEMPLATES.map(t => ({ key: t.key, label: t.label, onSelect: () => add(t.key) }))}
        />
      </div>
      {activePlan.incomes.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 italic">No income streams yet.</p>
      ) : (
        <div className="space-y-2">
          {activePlan.people.map(person => {
            const streams = activePlan.incomes.filter(i => i.ownerId === person.id)
            if (streams.length === 0) return null
            return (
              <div key={person.id} className="space-y-2">
                {activePlan.people.length > 1 && (
                  <div className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{person.name}</div>
                )}
                {streams.map(income => <IncomeEditor key={income.id} income={income} />)}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
