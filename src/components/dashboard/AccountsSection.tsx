import { useState } from 'react'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { useProjectionContext } from '@/contexts/ProjectionContext'
import { addAccount, deleteAccount, patchAccount, setAccountContributionRule } from '@/lib/plan/edits'
import { ACCOUNT_TYPES, type AccountType, type AccountV2 } from '@/lib/plan/schema'
import { ACCOUNT_DESCRIPTIONS, ACCOUNT_LABELS, accountGroup } from '@/lib/plan/accountGroups'
import { formatMoney } from '@/lib/formatting'
import { NumberInput } from '@/components/ui/NumberInput'
import { InfoTooltip } from './InfoTooltip'
import { StockAccountEditor } from './StockAccountEditor'
import { DropdownMenu } from '@/components/ui/Floating'

const GROUP_BADGE: Record<ReturnType<typeof accountGroup>, string> = {
  registered: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300',
  tfsa: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
  taxable: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300',
}

const ALLOCATION_PRESETS: { key: string; label: string; allocation?: AccountV2['allocation'] }[] = [
  { key: 'default', label: 'Plan default return' },
  { key: 'conservative', label: 'Conservative (20/70/10)', allocation: { equity: 20, bond: 70, cash: 10 } },
  { key: 'balanced', label: 'Balanced (60/40)', allocation: { equity: 60, bond: 40, cash: 0 } },
  { key: 'growth', label: 'Growth (80/20)', allocation: { equity: 80, bond: 20, cash: 0 } },
  { key: 'equity', label: 'All equity', allocation: { equity: 100, bond: 0, cash: 0 } },
  { key: 'custom', label: 'Custom return' },
]

const labelClass = 'text-xs text-gray-500 dark:text-gray-400'
const inputClass = 'w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20'

function presetKey(account: AccountV2): string {
  if (account.returnOverridePct !== undefined) return 'custom'
  if (!account.allocation) return 'default'
  const match = ALLOCATION_PRESETS.find(p => p.allocation &&
    p.allocation.equity === account.allocation!.equity &&
    p.allocation.bond === account.allocation!.bond &&
    p.allocation.cash === account.allocation!.cash)
  return match?.key ?? 'custom'
}

function AccountEditor({ account }: { account: AccountV2 }) {
  const { updateActivePlan, activePlan } = usePlanStore()
  const { compiledPlan } = useProjectionContext()
  const [open, setOpen] = useState(false)
  const update = (patch: Partial<AccountV2>) => updateActivePlan(p => patchAccount(p, account.id, patch))
  const contribution = account.contributions[0]
  const expected = compiledPlan.accounts.find(a => a.id === account.id)?.expectedReturnPct ?? activePlan.assumptions.expectedReturn
  const preset = presetKey(account)

  return (
    <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <span className={`px-2 py-0.5 text-xs font-semibold rounded ${GROUP_BADGE[accountGroup(account.type)]}`} title={ACCOUNT_DESCRIPTIONS[account.type]}>
          {ACCOUNT_LABELS[account.type]}
        </span>
        <input
          value={account.label}
          placeholder="Label (optional)"
          onChange={(e) => update({ label: e.target.value })}
          className="flex-1 min-w-0 bg-transparent text-xs text-gray-700 dark:text-gray-300 focus:outline-none"
          aria-label="Account label"
        />
        {account.type !== 'STOCK' && <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-0.5 text-xs text-indigo-600 dark:text-indigo-400 min-h-[28px]"
          aria-expanded={open}
        >
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          Details
        </button>}
        <button
          onClick={() => updateActivePlan(p => deleteAccount(p, account.id))}
          className="p-1 text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400"
          title="Delete account"
          aria-label="Delete account"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {account.type === 'STOCK' ? <StockAccountEditor account={account} /> : (<>
      <div className="grid grid-cols-1 xs:grid-cols-2 gap-2">
        <label className="flex items-center gap-1.5">
          <span className={`${labelClass} w-14 shrink-0`}>Balance</span>
          <NumberInput value={account.balance || 0} onChange={(v) => update({ balance: v })} step={1000} min={0} ariaLabel="Balance" />
        </label>
        <label className="flex items-center gap-1.5">
          <span className={`${labelClass} w-14 shrink-0`}>Annual</span>
          <NumberInput
            value={contribution?.amount ?? 0}
            onChange={(v) => updateActivePlan(p => setAccountContributionRule(p, account.id, { amount: v }))}
            step={500}
            min={0}
            ariaLabel="Annual contribution"
          />
        </label>
      </div>

      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 sm:col-span-2">
            <input
              type="checkbox"
              checked={contribution?.indexed ?? false}
              onChange={(e) => updateActivePlan(p => setAccountContributionRule(p, account.id, { indexed: e.target.checked }))}
              className="accent-indigo-500"
            />
            Increase contributions with inflation
          </label>
          <div className="sm:col-span-2">
            <span className={labelClass}>
              Investments
              <InfoTooltip text="Pick an asset mix to use the asset-class returns from Assumptions, or set a custom expected return for this account." />
            </span>
            <div className="flex gap-1.5 mt-1">
              <select
                value={preset}
                onChange={(e) => {
                  const choice = ALLOCATION_PRESETS.find(p => p.key === e.target.value)!
                  if (choice.key === 'custom') update({ allocation: undefined, returnOverridePct: Math.round(expected * 10) / 10 })
                  else update({ allocation: choice.allocation, returnOverridePct: undefined })
                }}
                className={`${inputClass} flex-1`}
                aria-label="Investment mix"
              >
                {ALLOCATION_PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
              {preset === 'custom' ? (
                <input
                  type="number"
                  step={0.1}
                  value={account.returnOverridePct ?? expected}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value)
                    if (Number.isFinite(v)) update({ returnOverridePct: v })
                  }}
                  className={`${inputClass} w-20`}
                  aria-label="Expected return %"
                />
              ) : (
                <span className="self-center text-xs text-gray-500 dark:text-gray-400 w-20 text-right">{expected.toFixed(1)}%/yr</span>
              )}
            </div>
          </div>

          {account.type === 'NONREG' && (
            <>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>
                  Cost base (ACB)
                  <InfoTooltip text="What you paid for the investments. The difference from the balance is an unrealized capital gain, taxed when you sell." />
                </span>
                <NumberInput value={account.acb ?? account.balance} onChange={(v) => update({ acb: v })} step={1000} min={0} ariaLabel="Adjusted cost base" />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>
                  Yearly distributions %
                  <InfoTooltip text="Interest and dividends paid each year as a % of the balance. They are reinvested but taxed every year (interest as income, eligible dividends with the dividend tax credit)." />
                </span>
                <div className="flex gap-1">
                  {(['interestPct', 'eligibleDividendPct'] as const).map(key => (
                    <input
                      key={key}
                      type="number"
                      step={0.1}
                      min={0}
                      value={account.yields?.[key] ?? 0}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value)
                        update({ yields: { interestPct: 0, eligibleDividendPct: 0, foreignDividendPct: 0, ...account.yields, [key]: Number.isFinite(v) ? v : 0 } })
                      }}
                      className={`${inputClass} w-full`}
                      aria-label={key === 'interestPct' ? 'Interest %' : 'Eligible dividends %'}
                      title={key === 'interestPct' ? 'Interest %' : 'Canadian eligible dividends %'}
                    />
                  ))}
                </div>
              </label>
            </>
          )}

          {account.type === 'FHSA' && (
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Contributed so far (lifetime)</span>
              <NumberInput value={account.lifetimeContributed} onChange={(v) => update({ lifetimeContributed: v })} step={1000} min={0} max={40000} ariaLabel="FHSA lifetime contributions" />
            </label>
          )}
          <p className="sm:col-span-2 text-[11px] text-gray-500 dark:text-gray-400">{ACCOUNT_DESCRIPTIONS[account.type]}</p>
        </div>
      )}
      </>)}
    </div>
  )
}

// Every account a person owns, including types the original forms did not support.
export function AccountsSection({ personId }: { personId: string }) {
  const { activePlan, updateActivePlan } = usePlanStore()
  const { simulation } = useProjectionContext()
  const accounts = activePlan.accounts.filter(a => a.ownerId === personId)
  const personIndex = activePlan.people.findIndex(p => p.id === personId)

  // First year a tracked contribution room goes negative.
  const overRoom = (key: 'rrspRoom' | 'tfsaRoom') =>
    simulation.rows.find(r => (r.people[personIndex]?.[key] ?? 0) < -1)

  const rrspOver = overRoom('rrspRoom')
  const tfsaOver = overRoom('tfsaRoom')

  const add = (type: AccountType) => updateActivePlan(p => addAccount(p, personId, type))

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Accounts</span>
        <DropdownMenu
          label="+ Add"
          buttonClassName="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-medium min-h-[28px]"
          menuClassName="w-48"
          items={ACCOUNT_TYPES.map(type => ({ key: type, label: ACCOUNT_LABELS[type], title: ACCOUNT_DESCRIPTIONS[type], onSelect: () => add(type) }))}
        />
      </div>

      {accounts.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 italic">No accounts</p>
      ) : (
        <div className="space-y-2">
          {accounts.map(account => <AccountEditor key={account.id} account={account} />)}
        </div>
      )}

      {(rrspOver || tfsaOver) && (
        <div className="mt-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-1.5 rounded border border-amber-200 dark:border-amber-800">
          {rrspOver && <div>Planned RRSP contributions exceed available room in {rrspOver.year} (over by ${formatMoney(-(rrspOver.people[personIndex].rrspRoom))}).</div>}
          {tfsaOver && <div>Planned TFSA contributions exceed available room in {tfsaOver.year} (over by ${formatMoney(-(tfsaOver.people[personIndex].tfsaRoom))}).</div>}
        </div>
      )}
    </div>
  )
}
