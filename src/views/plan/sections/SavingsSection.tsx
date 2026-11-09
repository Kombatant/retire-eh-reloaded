import { useState } from 'react'
import { PiggyBank } from 'lucide-react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { useProjectionContext } from '@/contexts/ProjectionContext'
import { useDetailLevel } from '@/hooks/useDetailLevel'
import { addAccount, deleteAccount, patchAccount, setAccountContributionRule } from '@/lib/plan/edits'
import { ACCOUNT_TYPES, PROVINCES, RRIF_EARLIEST_CONVERSION_AGE, RRIF_LATEST_CONVERSION_AGE, type AccountType, type AccountV2, type ProvinceCode } from '@/lib/plan/schema'
import { IntegerInput } from '@/components/ui/IntegerInput'
import { provinceName } from '@/lib/tax/labels'
import { ACCOUNT_DESCRIPTIONS, ACCOUNT_GROUP_LABELS, ACCOUNT_LABELS, accountGroup, accountValue, type AccountGroup } from '@/lib/plan/accountGroups'
import { newId } from '@/lib/plan/ids'
import { money } from '@/lib/formatting'
import { chartColors } from '@/lib/ui/chartTheme'
import { Card, CardHeader } from '@/components/ui/Card'
import { ListFrame, ListRow } from '@/components/ui/ListRow'
import { AddMenu } from '@/components/ui/AddMenu'
import { Sheet } from '@/components/ui/Sheet'
import { Field } from '@/components/ui/Field'
import { PercentInput, Select, TextInput } from '@/components/ui/inputs'
import { NumberInput } from '@/components/ui/NumberInput'
import { Checkbox } from '@/components/ui/Checkbox'
import { Callout } from '@/components/ui/Callout'
import { EmptyState } from '@/components/ui/EmptyState'
import { Advanced } from '@/components/ui/Advanced'
import { StockAccountEditor } from '../StockAccountEditor'
import { InvestmentMixFields } from '../InvestmentMixFields'

const GROUP_COLOR: Record<AccountGroup, string> = {
  registered: chartColors.registered,
  tfsa: chartColors.tfsa,
  taxable: chartColors.nonRegistered,
}

const NO_YIELDS = { interestPct: 0, eligibleDividendPct: 0, foreignDividendPct: 0 }

export function SavingsSection() {
  const { activePlan, updateActivePlan, selectedPersonId } = usePlanStore()
  const { simulation } = useProjectionContext()
  const { isAdvanced } = useDetailLevel()
  const [editingId, setEditingId] = useState<string | null>(null)
  const people = activePlan.people
  const accounts = activePlan.accounts
  const usdCad = activePlan.assumptions.usdCad.rate
  const editing = accounts.find(a => a.id === editingId) ?? null
  const ownerId = selectedPersonId ?? people[0].id

  const add = (type: AccountType) => {
    const id = newId('account')
    updateActivePlan(p => addAccount(p, ownerId, type, id))
    setEditingId(id)
  }

  const addable = ACCOUNT_TYPES.filter(t => isAdvanced || t !== 'STOCK')

  // Contribution-room warnings: first year a tracked room goes negative.
  const roomWarnings = people.flatMap((person, idx) => (['rrspRoom', 'tfsaRoom'] as const).flatMap(key => {
    const row = simulation.rows.find(r => (r.people[idx]?.[key] ?? 0) < -1)
    if (!row) return []
    const label = key === 'rrspRoom' ? 'RRSP' : 'TFSA'
    const who = people.length > 1 ? `${person.name}'s ` : ''
    return [`${who}planned ${label} contributions exceed the available room in ${row.year} (by ${money(-row.people[idx][key])}).`]
  }))

  const totals: Record<AccountGroup, number> = { registered: 0, tfsa: 0, taxable: 0 }
  for (const a of accounts) totals[accountGroup(a.type)] += accountValue(a, usdCad)
  const total = totals.registered + totals.tfsa + totals.taxable

  return (
    <>
      <Card>
        <CardHeader
          title="Accounts"
          description={total > 0 ? `${money(total)} saved across ${accounts.length} account${accounts.length === 1 ? '' : 's'}` : 'Add the accounts you save in today.'}
          actions={
            <AddMenu
              label="Add account"
              items={addable.map(type => ({ key: type, label: ACCOUNT_LABELS[type], title: ACCOUNT_DESCRIPTIONS[type], onSelect: () => add(type) }))}
            />
          }
        />

        {total > 0 && <CompositionBar totals={totals} total={total} />}

        {accounts.length === 0 ? (
          <EmptyState icon={PiggyBank} title="No accounts yet" description="Add an RRSP, TFSA or other account to project how your savings grow." />
        ) : (
          <div className="space-y-4">
            {people.map(person => {
              const owned = accounts.filter(a => a.ownerId === person.id)
              if (owned.length === 0) return null
              return (
                <div key={person.id}>
                  {people.length > 1 && <div className="mb-1.5 text-xs font-medium text-fg-muted">{person.name}</div>}
                  <ListFrame>
                    {owned.map(account => {
                      const contribution = account.contributions[0]?.amount ?? 0
                      return (
                        <ListRow
                          key={account.id}
                          leading={<span className="block h-2.5 w-2.5 rounded-full" style={{ background: GROUP_COLOR[accountGroup(account.type)] }} aria-hidden />}
                          title={account.label || ACCOUNT_LABELS[account.type]}
                          subtitle={account.label ? ACCOUNT_LABELS[account.type] : ACCOUNT_DESCRIPTIONS[account.type]}
                          value={money(accountValue(account, usdCad))}
                          valueSub={account.type !== 'STOCK' && contribution > 0 ? `+${money(contribution)}/yr` : undefined}
                          onOpen={() => setEditingId(account.id)}
                          openLabel={`Edit ${account.label || ACCOUNT_LABELS[account.type]}`}
                          onRemove={() => {
                            if (window.confirm(`Remove ${account.label || ACCOUNT_LABELS[account.type]}?`)) updateActivePlan(p => deleteAccount(p, account.id))
                          }}
                          removeLabel={`Remove ${account.label || ACCOUNT_LABELS[account.type]}`}
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

      {roomWarnings.length > 0 && (
        <Callout tone="warning" title="Over your contribution room">
          {roomWarnings.map(w => <div key={w}>{w}</div>)}
        </Callout>
      )}

      <Sheet
        open={editing !== null}
        onClose={() => setEditingId(null)}
        title={editing ? (editing.label || ACCOUNT_LABELS[editing.type]) : ''}
        description={editing ? ACCOUNT_DESCRIPTIONS[editing.type] : undefined}
        size={editing?.type === 'STOCK' ? 'lg' : 'md'}
      >
        {editing && <AccountEditor account={editing} />}
      </Sheet>
    </>
  )
}

function CompositionBar({ totals, total }: { totals: Record<AccountGroup, number>; total: number }) {
  const groups = (Object.keys(totals) as AccountGroup[]).filter(g => totals[g] > 0)
  return (
    <div className="mb-5">
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {groups.map(g => (
          <div key={g} style={{ width: `${(totals[g] / total) * 100}%`, background: GROUP_COLOR[g] }} />
        ))}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-fg-secondary">
        {groups.map(g => (
          <li key={g} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: GROUP_COLOR[g] }} aria-hidden />
            {ACCOUNT_GROUP_LABELS[g]}
            <span className="font-medium text-fg">{money(totals[g])}</span>
            <span className="text-fg-muted">{Math.round((totals[g] / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function AccountEditor({ account }: { account: AccountV2 }) {
  const { activePlan, updateActivePlan } = usePlanStore()
  const { compiledPlan } = useProjectionContext()
  const update = (patch: Partial<AccountV2>) => updateActivePlan(p => patchAccount(p, account.id, patch))
  const contribution = account.contributions[0]
  const expected = compiledPlan.accounts.find(a => a.id === account.id)?.expectedReturnPct ?? activePlan.assumptions.expectedReturn

  const common = (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Name" hint="Optional, e.g. “Work RRSP”.">
        <TextInput value={account.label} placeholder={ACCOUNT_LABELS[account.type]} onChange={(e) => update({ label: e.target.value })} />
      </Field>
      {activePlan.people.length > 1 && (
        <Field label="Owner">
          <Select value={account.ownerId} onChange={(e) => update({ ownerId: e.target.value })}>
            {activePlan.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
      )}
    </div>
  )

  if (account.type === 'STOCK') {
    return (
      <div className="space-y-6">
        {common}
        <StockAccountEditor account={account} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {common}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Balance today">
          <NumberInput value={account.balance || 0} min={0} onChange={(v) => update({ balance: v })} />
        </Field>
        <Field label="Contribution per year" hint="Until retirement.">
          <NumberInput
            value={contribution?.amount ?? 0}
            min={0}
            onChange={(v) => updateActivePlan(p => setAccountContributionRule(p, account.id, { amount: v }))}
          />
        </Field>
      </div>

      <div className="space-y-4 border-t border-border pt-5">
        <InvestmentMixFields value={account} expected={expected} onChange={update} />
        <Advanced>
          <Checkbox
            checked={contribution?.indexed ?? false}
            onChange={(on) => updateActivePlan(p => setAccountContributionRule(p, account.id, { indexed: on }))}
            label="Increase contributions with inflation"
          />
        </Advanced>
      </div>

      {account.type === 'FHSA' && (
        <Field label="Contributed so far (lifetime)" hint="FHSA lifetime limit is $40,000.">
          <NumberInput value={account.lifetimeContributed} min={0} max={40000} onChange={(v) => update({ lifetimeContributed: v })} />
        </Field>
      )}

      {account.type === 'RRSP' && (
        <Advanced>
          <Field
            label="Convert this account to a RRIF at age"
            info="Overrides the age under Withdrawals for this account. To convert only part of an RRSP, enter that part as a separate RRSP account with its own age."
          >
            <div className="flex items-center gap-2">
              <IntegerInput
                className="w-24"
                value={account.rrifConversionAge ?? activePlan.drawdown.rrifConversionAge}
                min={RRIF_EARLIEST_CONVERSION_AGE}
                max={RRIF_LATEST_CONVERSION_AGE}
                onChange={(v) => update({ rrifConversionAge: v })}
              />
              {account.rrifConversionAge !== undefined && (
                <button type="button" className="text-[13px] font-medium text-fg-secondary hover:text-fg" onClick={() => update({ rrifConversionAge: undefined })}>
                  Use the plan's age
                </button>
              )}
            </div>
          </Field>
        </Advanced>
      )}

      {(account.type === 'LIRA' || account.type === 'LIF') && (
        <Field label="Pension rules" info="The jurisdiction whose pension law governs this account. It can differ from where you live, for example with a federally regulated employer. Quebec has no maximum withdrawal from age 55; others use a typical provincial formula.">
          <Select
            value={account.jurisdiction ?? ''}
            onChange={(e) => update({ jurisdiction: e.target.value === '' ? undefined : e.target.value as ProvinceCode | 'FED' })}
          >
            <option value="">Where I live</option>
            <option value="FED">Federal</option>
            {PROVINCES.map(code => <option key={code} value={code}>{provinceName(code)}</option>)}
          </Select>
        </Field>
      )}

      {account.type === 'NONREG' && (
        <Advanced>
          <div className="grid grid-cols-1 gap-4 border-t border-border pt-5 sm:grid-cols-3">
            <Field label="Cost base (ACB)" info="What you paid for the investments. The difference from the balance is a capital gain, taxed when sold.">
              <NumberInput value={account.acb ?? account.balance} min={0} onChange={(v) => update({ acb: v })} />
            </Field>
            <Field label="Interest per year" info="Paid as a % of the balance, reinvested, and taxed every year as income.">
              <PercentInput
                value={account.yields?.interestPct ?? 0}
                min={0}
                onChange={(v) => update({ yields: { ...NO_YIELDS, ...account.yields, interestPct: v } })}
              />
            </Field>
            <Field label="Dividends per year" info="Canadian eligible dividends, reinvested and taxed every year with the dividend tax credit.">
              <PercentInput
                value={account.yields?.eligibleDividendPct ?? 0}
                min={0}
                onChange={(v) => update({ yields: { ...NO_YIELDS, ...account.yields, eligibleDividendPct: v } })}
              />
            </Field>
          </div>
        </Advanced>
      )}
    </div>
  )
}
