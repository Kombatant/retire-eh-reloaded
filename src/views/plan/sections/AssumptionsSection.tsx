import { useId } from 'react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { useAssumptions } from '@/contexts/AssumptionsContext'
import { patchAssumptions } from '@/lib/plan/edits'
import { labelClass } from '@/lib/ui/styles'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { PercentInput } from '@/components/ui/inputs'
import { Checkbox } from '@/components/ui/Checkbox'
import { InfoTooltip } from '@/components/ui/InfoTooltip'
import { Advanced } from '@/components/ui/Advanced'

function RateSlider({ label, info, value, min, max, step, onChange }: {
  label: string
  info: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  const id = useId()
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1">
        <label htmlFor={id} className={labelClass}>{label}</label>
        <InfoTooltip text={info} />
      </div>
      <div className="flex items-center gap-4">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => { if (!Number.isNaN(e.target.valueAsNumber)) onChange(e.target.valueAsNumber) }}
          className="h-5 flex-1"
          aria-label={`${label} slider`}
        />
        <PercentInput id={id} className="w-24" value={value} min={min} max={max} onChange={onChange} />
      </div>
    </div>
  )
}

export function AssumptionsSection() {
  const assumptions = useAssumptions()
  const { activePlan, updateActivePlan } = usePlanStore()
  const r = activePlan.assumptions.assetReturns
  const setReturns = (patch: Partial<typeof r>) => updateActivePlan(p => patchAssumptions(p, { assetReturns: { ...r, ...patch } }))

  return (
    <>
      <Card>
        <CardHeader
          title="Market and inflation"
          description="Long-run yearly rates used for every projection. Lower returns are the more cautious choice."
        />
        <div className="space-y-6">
          <RateSlider
            label="Investment return"
            info="The yearly rate you expect savings to compound at over the long run, before inflation and after fees. Accounts with an investment mix use the asset-class returns instead."
            value={assumptions.expectedReturn}
            min={0}
            max={15}
            step={0.5}
            onChange={assumptions.setExpectedReturn}
          />
          <RateSlider
            label="Inflation"
            info="Expected average yearly rise in prices. The Bank of Canada targets 2%."
            value={assumptions.inflationRate}
            min={0}
            max={10}
            step={0.5}
            onChange={assumptions.setInflationRate}
          />
          <Checkbox
            checked={assumptions.reinvestRrspRefund}
            onChange={assumptions.setReinvestRrspRefund}
            label="Reinvest RRSP tax refunds"
            description="Adds each year's refund from RRSP and FHSA contributions to your TFSA. Off is more cautious."
          />
        </div>
      </Card>

      <Advanced>
        <Card>
          <CardHeader
            title="Asset-class returns"
            description="Compounded yearly rates, used for accounts with an investment mix (Savings › account › Investment mix). Defaults follow FP Canada's projection guidelines."
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Stocks">
              <PercentInput value={r.equityPct} min={-10} max={30} onChange={(v) => setReturns({ equityPct: v })} />
            </Field>
            <Field label="Bonds">
              <PercentInput value={r.bondPct} min={-10} max={30} onChange={(v) => setReturns({ bondPct: v })} />
            </Field>
            <Field label="Cash">
              <PercentInput value={r.cashPct} min={-10} max={30} onChange={(v) => setReturns({ cashPct: v })} />
            </Field>
          </div>
        </Card>
      </Advanced>

      <p className="text-xs text-fg-muted">
        Income tax is estimated with 2026 federal and provincial rules for each person's province.
      </p>
    </>
  )
}
