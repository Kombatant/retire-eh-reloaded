import { ArrowDown, ArrowUp } from 'lucide-react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { useProjectionContext } from '@/contexts/ProjectionContext'
import { useRoute } from '@/contexts/RouteContext'
import { useDetailLevel } from '@/hooks/useDetailLevel'
import { patchDrawdown, patchEstate } from '@/lib/plan/edits'
import type { AccountType, SpendingStrategy } from '@/lib/plan/schema'
import { ACCOUNT_LABELS } from '@/lib/plan/accountGroups'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { DecimalInput, PercentInput, Select } from '@/components/ui/inputs'
import { IntegerInput } from '@/components/ui/IntegerInput'
import { NumberInput } from '@/components/ui/NumberInput'
import { Checkbox } from '@/components/ui/Checkbox'
import { IconButton } from '@/components/ui/Button'
import { Advanced } from '@/components/ui/Advanced'
import { RRIF_EARLIEST_CONVERSION_AGE, RRIF_LATEST_CONVERSION_AGE } from '@/lib/plan/schema'
import { InvestmentMixFields } from '../InvestmentMixFields'

const STRATEGIES: { kind: SpendingStrategy['kind']; label: string; help: string; advanced?: boolean }[] = [
  { kind: 'initialPct', label: 'Fixed withdrawal rate', help: 'Withdraw a % of savings in the first retirement year, then the same amount each year adjusted for inflation (the classic 4% rule).' },
  { kind: 'expenses', label: 'Fund my spending', help: 'Withdraw exactly what your spending needs after other income and tax.' },
  { kind: 'pctPortfolio', label: '% of current savings', advanced: true, help: 'Withdraw a fixed share of whatever savings are worth each year. Spending rises and falls with markets.' },
  { kind: 'guytonKlinger', label: 'Guardrails', advanced: true, help: 'Start at an initial rate, then cut spending when the withdrawal rate rises too far above it and raise spending when it falls too far below.' },
  { kind: 'vpw', label: 'Variable percentage (VPW)', advanced: true, help: 'Each year, withdraw the amount that would spend savings evenly over the remaining years at the expected return.' },
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

export function WithdrawalsSection() {
  const { activePlan, updateActivePlan } = usePlanStore()
  const { compiledPlan } = useProjectionContext()
  const { navigate } = useRoute()
  const { isAdvanced } = useDetailLevel()
  const d = activePlan.drawdown
  const s = d.strategy
  const update = (patch: Partial<typeof d>) => updateActivePlan(p => patchDrawdown(p, patch))
  const setStrategy = (strategy: SpendingStrategy) => update({ strategy })
  const couple = activePlan.people.length === 2
  const current = STRATEGIES.find(x => x.kind === s.kind)
  const destination = compiledPlan.reinvestAccount >= 0 ? compiledPlan.accounts[compiledPlan.reinvestAccount] : undefined
  const destinationLabel = activePlan.accounts.find(a => a.id === destination?.id)?.label

  const move = (type: AccountType, delta: number) => {
    const order = [...d.customOrder]
    const i = order.indexOf(type)
    const j = i + delta
    if (i < 0 || j < 0 || j >= order.length) return
    ;[order[i], order[j]] = [order[j], order[i]]
    update({ customOrder: order })
  }

  const positive = (apply: (v: number) => void) => (v: number) => { if (v > 0) apply(v) }

  return (
    <>
      <Card>
        <CardHeader title="How much to withdraw" description="The rule that sets your retirement spending from savings each year." />
        <div className="space-y-4">
          <Field label="Withdrawal strategy" hint={current?.help}>
            <Select value={s.kind} onChange={(e) => setStrategy(defaultStrategy(e.target.value as SpendingStrategy['kind'], s))}>
              {STRATEGIES.filter(x => isAdvanced || !x.advanced || x.kind === s.kind).map(x => (
                <option key={x.kind} value={x.kind}>{x.label}</option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {s.kind === 'initialPct' && (
              <Field label="Initial withdrawal rate">
                <PercentInput value={s.ratePct} min={0.1} max={20} onChange={positive(v => setStrategy({ ...s, ratePct: v }))} />
              </Field>
            )}
            {s.kind === 'pctPortfolio' && (
              <>
                <Field label="Rate">
                  <PercentInput value={s.ratePct} min={0.1} max={20} onChange={positive(v => setStrategy({ ...s, ratePct: v }))} />
                </Field>
                <Field label="Floor (% of first year)" info="Never withdraw less than this share of the first year's amount. 0 means no floor.">
                  <PercentInput value={s.floorPct ?? 0} min={0} max={100} onChange={(v) => setStrategy({ ...s, floorPct: v > 0 ? v : undefined })} />
                </Field>
                <Field label="Ceiling (% of first year)" info="Never withdraw more than this share of the first year's amount. 0 means no ceiling.">
                  <DecimalInput suffix="%" value={s.ceilingPct ?? 0} min={0} max={300} onChange={(v) => setStrategy({ ...s, ceilingPct: v >= 100 ? v : undefined })} />
                </Field>
              </>
            )}
            {s.kind === 'guytonKlinger' && (
              <>
                <Field label="Initial rate">
                  <PercentInput value={s.initialRatePct} min={0.1} max={20} onChange={positive(v => setStrategy({ ...s, initialRatePct: v }))} />
                </Field>
                <Field label="Guardrail" info="How far the withdrawal rate may drift from the initial rate before spending changes.">
                  <PercentInput value={s.guardrailPct} min={1} max={100} onChange={(v) => setStrategy({ ...s, guardrailPct: v })} />
                </Field>
                <Field label="Adjustment" info="Size of each spending cut or raise.">
                  <PercentInput value={s.adjustmentPct} min={1} max={50} onChange={(v) => setStrategy({ ...s, adjustmentPct: v })} />
                </Field>
              </>
            )}
          </div>
          {activePlan.expenses.mode === 'detailed' && s.kind !== 'initialPct' && s.kind !== 'expenses' && (
            <p className="text-xs text-fg-muted">Withdrawals never drop below what your essential budget items need.</p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Which accounts first" description="The order savings are drawn from. Required RRIF and LIF minimums always come out." />
        <div className="space-y-4">
          <Field
            label="Withdrawal order"
            info="Pro rata draws from every account in proportion to its balance. A custom order empties accounts in sequence; a common tax-aware order uses non-registered savings and the RRSP/RRIF first and keeps the TFSA for last."
          >
            <Select value={d.order} onChange={(e) => update({ order: e.target.value as typeof d.order })}>
              <option value="proRata">All accounts together (pro rata)</option>
              {(isAdvanced || d.order === 'custom') && <option value="custom">Custom order</option>}
            </Select>
          </Field>
          {d.order === 'custom' && (
            <ol className="divide-y divide-border rounded-lg border border-border">
              {d.customOrder.map((type, i) => (
                <li key={type} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                  <span className="w-5 text-fg-muted">{i + 1}.</span>
                  <span className="flex-1 text-fg">{ACCOUNT_LABELS[type]}</span>
                  <IconButton icon={ArrowUp} size="sm" label={`Move ${ACCOUNT_LABELS[type]} earlier`} disabled={i === 0} onClick={() => move(type, -1)} />
                  <IconButton icon={ArrowDown} size="sm" label={`Move ${ACCOUNT_LABELS[type]} later`} disabled={i === d.customOrder.length - 1} onClick={() => move(type, 1)} />
                </li>
              ))}
            </ol>
          )}
          {couple && (
            <Checkbox
              checked={d.pensionSplitting}
              onChange={(on) => update({ pensionSplitting: on })}
              label="Split eligible pension income"
              description="Moves up to half of eligible pension income to the lower-income spouse to reduce household tax."
            />
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Converting RRSPs to RRIFs" description="You choose when, at any age up to the end of the year you turn 71." />
        <div className="space-y-3">
          <Field label="Convert at age" className="w-48">
            <IntegerInput value={d.rrifConversionAge} min={RRIF_EARLIEST_CONVERSION_AGE} max={RRIF_LATEST_CONVERSION_AGE} onChange={(v) => update({ rrifConversionAge: v })} />
          </Field>
          <p className="text-xs text-fg-muted">
            From 65, RRIF payments qualify for the pension income credit and pension splitting, which plain RRSP withdrawals don't. The catch is a required minimum withdrawal every year, starting the year after you convert. Converting before 65 rarely helps.
          </p>
        </div>
      </Card>

      <Advanced>
        <Card>
          <CardHeader title="RRSP, RRIF and estate" description="Tax planning for registered savings and what you leave behind." />
          <div className="space-y-4">
            {couple && (
              <Checkbox
                checked={d.rrifUseYoungerSpouseAge}
                onChange={(on) => update({ rrifUseYoungerSpouseAge: on })}
                label="Base RRIF minimums on the younger spouse's age"
              />
            )}
            <Checkbox
              checked={d.meltdown.enabled}
              onChange={(on) => update({ meltdown: { ...d.meltdown, enabled: on } })}
              label="RRSP meltdown"
              description="Withdraw extra from RRSP/RRIF accounts each year up to a target taxable income and reinvest it (TFSA first), using low tax brackets early."
            />
            {d.meltdown.enabled && (
              <Field label="Target taxable income per person" hint="Today's dollars." className="sm:w-64">
                <NumberInput value={d.meltdown.targetTaxableIncome} min={0} onChange={(v) => update({ meltdown: { ...d.meltdown, targetTaxableIncome: v } })} />
              </Field>
            )}
            {destination?.synthetic && (
              <InvestmentMixFields
                label="Investment mix of the new non-registered account"
                hint="Reinvested money that doesn't fit in a TFSA goes to a non-registered account the plan creates. RRIF minimums you don't need and other money the plan invests for you can land there too."
                value={d.reinvestGrowth}
                expected={destination.expectedReturnPct}
                onChange={(patch) => update({ reinvestGrowth: { ...d.reinvestGrowth, ...patch } })}
              />
            )}
            {destination && !destination.synthetic && d.meltdown.enabled && (
              <p className="text-xs text-fg-muted">
                Reinvested money that doesn't fit in a TFSA goes to your non-registered account{destinationLabel ? ` (${destinationLabel})` : ''}.{' '}
                <button type="button" className="font-medium text-fg-secondary underline hover:text-fg" onClick={() => navigate({ view: 'plan', sub: 'savings' })}>
                  Set its investment mix under Savings
                </button>
              </p>
            )}
            <Checkbox
              checked={activePlan.estate.probate}
              onChange={(on) => updateActivePlan(p => patchEstate(p, { probate: on }))}
              label="Include estimated probate fees in the estate figure"
            />
          </div>
        </Card>
      </Advanced>
    </>
  )
}
