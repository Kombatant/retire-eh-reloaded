import { ArrowDownToLine } from 'lucide-react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { patchDrawdown, patchEstate } from '@/lib/plan/edits'
import type { AccountType, SpendingStrategy } from '@/lib/plan/schema'
import { ACCOUNT_LABELS } from '@/lib/plan/accountGroups'
import { NumberInput } from '@/components/ui/NumberInput'
import { InfoTooltip } from './InfoTooltip'

const labelClass = 'block text-xs text-gray-500 dark:text-gray-400 mb-1'
const inputClass = 'w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20'
const checkClass = 'flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300'

const STRATEGIES: { kind: SpendingStrategy['kind']; label: string; help: string }[] = [
  { kind: 'initialPct', label: 'Fixed withdrawal rate', help: 'Withdraw a % of the portfolio in the first retirement year, then the same amount adjusted for inflation (the classic 4% rule).' },
  { kind: 'expenses', label: 'Fund my spending', help: 'Withdraw exactly what spending needs after other income and tax.' },
  { kind: 'pctPortfolio', label: '% of current portfolio', help: 'Withdraw a fixed share of whatever the portfolio is worth each year. Spending rises and falls with markets; optional floor and ceiling.' },
  { kind: 'guytonKlinger', label: 'Guardrails (Guyton-Klinger)', help: 'Start at an initial rate and adjust for inflation, but cut spending when the withdrawal rate rises too far above the start and raise it when it falls too far below.' },
  { kind: 'vpw', label: 'Variable percentage (VPW)', help: 'Each year, withdraw the amount that would spend the portfolio evenly over the remaining years at the expected return.' },
]

function defaultStrategy(kind: SpendingStrategy['kind'], current: SpendingStrategy): SpendingStrategy {
  const rate = current.kind === 'initialPct' || current.kind === 'pctPortfolio' ? current.ratePct
    : current.kind === 'guytonKlinger' ? current.initialRatePct : 4
  switch (kind) {
    case 'initialPct': return { kind, ratePct: rate }
    case 'expenses': return { kind }
    case 'pctPortfolio': return { kind, ratePct: rate }
    case 'guytonKlinger': return { kind, initialRatePct: Math.max(rate, 5), guardrailPct: 20, adjustmentPct: 10 }
    case 'vpw': return { kind }
  }
}

function PercentField({ label, value, onChange, step = 0.1, min = 0, max = 100, help }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; step?: number; min?: number; max?: number; help?: string }) {
  return (
    <label>
      <span className={labelClass}>{label}{help && <InfoTooltip text={help} />}</span>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value ?? ''}
        onChange={(e) => {
          if (e.target.value === '') return onChange(undefined)
          const v = parseFloat(e.target.value)
          if (Number.isFinite(v)) onChange(v)
        }}
        className={inputClass}
      />
    </label>
  )
}

export function DrawdownPanel() {
  const { activePlan, updateActivePlan } = usePlanStore()
  const d = activePlan.drawdown
  const s = d.strategy
  const update = (patch: Partial<typeof d>) => updateActivePlan(p => patchDrawdown(p, patch))
  const setStrategy = (strategy: SpendingStrategy) => update({ strategy })
  const couple = activePlan.people.length === 2

  const moveInOrder = (type: AccountType, delta: number) => {
    const order = [...d.customOrder]
    const i = order.indexOf(type)
    const j = i + delta
    if (i < 0 || j < 0 || j >= order.length) return
    ;[order[i], order[j]] = [order[j], order[i]]
    update({ customOrder: order })
  }

  return (
    <div className="animate-fade-in-up card p-4 space-y-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-white">
        <ArrowDownToLine className="w-4 h-4 text-violet-500" />
        Retirement drawdown
      </h2>

      <div className="space-y-2">
        <label className="block">
          <span className={labelClass}>
            Withdrawal strategy
            <InfoTooltip text={STRATEGIES.find(x => x.kind === s.kind)?.help ?? ''} />
          </span>
          <select value={s.kind} onChange={(e) => setStrategy(defaultStrategy(e.target.value as SpendingStrategy['kind'], s))} className={inputClass}>
            {STRATEGIES.map(x => <option key={x.kind} value={x.kind}>{x.label}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {s.kind === 'initialPct' && (
            <PercentField label="Initial rate %" value={s.ratePct} onChange={(v) => v !== undefined && v > 0 && setStrategy({ ...s, ratePct: v })} />
          )}
          {s.kind === 'pctPortfolio' && (
            <>
              <PercentField label="Rate %" value={s.ratePct} onChange={(v) => v !== undefined && v > 0 && setStrategy({ ...s, ratePct: v })} />
              <PercentField label="Floor % of first year" value={s.floorPct} max={100} step={5} onChange={(v) => setStrategy({ ...s, floorPct: v })} help="Never withdraw less than this share of the first year's amount (blank = no floor)." />
              <PercentField label="Ceiling % of first year" value={s.ceilingPct} min={100} max={300} step={5} onChange={(v) => setStrategy({ ...s, ceilingPct: v })} help="Never withdraw more than this share of the first year's amount (blank = no ceiling)." />
            </>
          )}
          {s.kind === 'guytonKlinger' && (
            <>
              <PercentField label="Initial rate %" value={s.initialRatePct} onChange={(v) => v !== undefined && v > 0 && setStrategy({ ...s, initialRatePct: v })} />
              <PercentField label="Guardrail %" value={s.guardrailPct} step={5} min={1} onChange={(v) => v !== undefined && setStrategy({ ...s, guardrailPct: v })} help="How far the current withdrawal rate may drift from the initial rate before spending is adjusted." />
              <PercentField label="Adjustment %" value={s.adjustmentPct} step={5} min={1} max={50} onChange={(v) => v !== undefined && setStrategy({ ...s, adjustmentPct: v })} help="Size of each spending cut or raise." />
            </>
          )}
        </div>
        {activePlan.expenses.mode === 'detailed' && s.kind !== 'initialPct' && s.kind !== 'expenses' && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400">Withdrawals never drop below what your essential budget items need.</p>
        )}
      </div>

      <div className="space-y-2 border-t border-gray-200 dark:border-gray-700 pt-3">
        <label className="block">
          <span className={labelClass}>
            Withdrawal order
            <InfoTooltip text="Pro rata takes from every account in proportion to its balance. A custom order empties accounts in sequence; a common tax-aware order draws non-registered savings and RRSP/RRIF first and leaves the TFSA for last. Required RRIF/LIF minimums always come out." />
          </span>
          <select value={d.order} onChange={(e) => update({ order: e.target.value as typeof d.order })} className={inputClass}>
            <option value="proRata">Pro rata (all accounts together)</option>
            <option value="custom">Custom order</option>
          </select>
        </label>
        {d.order === 'custom' && (
          <ol className="space-y-1">
            {d.customOrder.map((type, i) => (
              <li key={type} className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                <span className="w-5 text-gray-400">{i + 1}.</span>
                <span className="flex-1">{ACCOUNT_LABELS[type]}</span>
                <button onClick={() => moveInOrder(type, -1)} disabled={i === 0} className="px-2 min-h-[28px] text-indigo-600 disabled:text-gray-300" aria-label={`Move ${ACCOUNT_LABELS[type]} earlier`}>↑</button>
                <button onClick={() => moveInOrder(type, 1)} disabled={i === d.customOrder.length - 1} className="px-2 min-h-[28px] text-indigo-600 disabled:text-gray-300" aria-label={`Move ${ACCOUNT_LABELS[type]} later`}>↓</button>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border-t border-gray-200 dark:border-gray-700 pt-3">
        <label>
          <span className={labelClass}>
            Convert RRSP to RRIF at age
            <InfoTooltip text="An RRSP must become a RRIF by the end of the year you turn 71. Minimum withdrawals start the following year. Converting earlier also lets RRIF income qualify for the pension credit and pension splitting at 65." />
          </span>
          <input type="number" min={55} max={71} value={d.rrifConversionAge} onChange={(e) => update({ rrifConversionAge: Math.min(71, Math.max(55, parseInt(e.target.value, 10) || 71)) })} className={inputClass} />
        </label>
        <div className="space-y-2 pt-5">
          {couple && (
            <label className={checkClass}>
              <input type="checkbox" checked={d.rrifUseYoungerSpouseAge} onChange={(e) => update({ rrifUseYoungerSpouseAge: e.target.checked })} className="accent-indigo-500" />
              Base RRIF minimums on the younger spouse
            </label>
          )}
          {couple && (
            <label className={checkClass}>
              <input type="checkbox" checked={d.pensionSplitting} onChange={(e) => update({ pensionSplitting: e.target.checked })} className="accent-indigo-500" />
              Split pension income
            </label>
          )}
        </div>
      </div>

      <div className="space-y-2 border-t border-gray-200 dark:border-gray-700 pt-3">
        <label className={checkClass}>
          <input type="checkbox" checked={d.meltdown.enabled} onChange={(e) => update({ meltdown: { ...d.meltdown, enabled: e.target.checked } })} className="accent-indigo-500" />
          RRSP meltdown
          <InfoTooltip text="In retirement, withdraw extra from RRSP/RRIF accounts to fill each person's taxable income up to a target, and reinvest the after-tax cash (TFSA first). This uses low tax brackets early, before CPP/OAS and RRIF minimums push income up, and shrinks the RRIF taxed at death." />
        </label>
        {d.meltdown.enabled && (
          <label className="block">
            <span className={labelClass}>Target taxable income per person (today's $)</span>
            <NumberInput value={d.meltdown.targetTaxableIncome} onChange={(v) => update({ meltdown: { ...d.meltdown, targetTaxableIncome: v } })} step={1000} min={0} ariaLabel="Meltdown target taxable income" />
          </label>
        )}
      </div>

      <label className={`${checkClass} border-t border-gray-200 dark:border-gray-700 pt-3`}>
        <input type="checkbox" checked={activePlan.estate.probate} onChange={(e) => updateActivePlan(p => patchEstate(p, { probate: e.target.checked }))} className="accent-indigo-500" />
        Include probate fees in the estate estimate
      </label>
    </div>
  )
}
