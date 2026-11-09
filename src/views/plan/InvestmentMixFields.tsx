import type { AccountV2 } from '@/lib/plan/schema'
import { Field } from '@/components/ui/Field'
import { PercentInput, Select } from '@/components/ui/inputs'
import { Advanced } from '@/components/ui/Advanced'

export type InvestmentGrowth = Pick<AccountV2, 'allocation' | 'returnOverridePct'>

const ALLOCATION_PRESETS: { key: string; label: string; allocation?: AccountV2['allocation'] }[] = [
  { key: 'default', label: 'Plan default return' },
  { key: 'conservative', label: 'Conservative (20% stocks)', allocation: { equity: 20, bond: 70, cash: 10 } },
  { key: 'balanced', label: 'Balanced (60% stocks)', allocation: { equity: 60, bond: 40, cash: 0 } },
  { key: 'growth', label: 'Growth (80% stocks)', allocation: { equity: 80, bond: 20, cash: 0 } },
  { key: 'equity', label: 'All stocks', allocation: { equity: 100, bond: 0, cash: 0 } },
]

function presetKey({ allocation: a, returnOverridePct }: InvestmentGrowth): string {
  if (returnOverridePct !== undefined) return 'custom'
  if (!a) return 'default'
  return ALLOCATION_PRESETS.find(p => p.allocation && p.allocation.equity === a.equity && p.allocation.bond === a.bond && p.allocation.cash === a.cash)?.key ?? 'custom'
}

interface InvestmentMixFieldsProps {
  value: InvestmentGrowth
  // The account's resulting yearly return, from the compiled plan.
  expected: number
  onChange: (patch: InvestmentGrowth) => void
  label?: string
  hint?: string
}

export function InvestmentMixFields({ value, expected, onChange, label = 'Investment mix', hint }: InvestmentMixFieldsProps) {
  const preset = presetKey(value)
  return (
    <>
      <Field label={label} hint={hint} info="A mix uses the asset-class returns under Assumptions. The plan default uses the single expected return.">
        <Select
          value={preset}
          onChange={(e) => {
            const choice = ALLOCATION_PRESETS.find(p => p.key === e.target.value)
            if (e.target.value === 'custom') onChange({ allocation: undefined, returnOverridePct: Math.round(expected * 10) / 10 })
            else if (choice) onChange({ allocation: choice.allocation, returnOverridePct: undefined })
          }}
        >
          {ALLOCATION_PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          <option value="custom" disabled={preset !== 'custom'}>Custom return</option>
        </Select>
      </Field>
      <p className="text-xs text-fg-muted">Expected return: <span className="font-medium text-fg">{expected.toFixed(1)}% a year</span></p>
      <Advanced>
        <Field label="Custom expected return" hint="A compounded yearly rate. Overrides the mix for this account only. Clear it to go back to the mix.">
          <div className="flex gap-2">
            <PercentInput
              className="w-32"
              value={value.returnOverridePct ?? expected}
              onChange={(v) => onChange({ allocation: undefined, returnOverridePct: v })}
            />
            {value.returnOverridePct !== undefined && (
              <button type="button" className="text-[13px] font-medium text-fg-secondary hover:text-fg" onClick={() => onChange({ returnOverridePct: undefined })}>
                Clear
              </button>
            )}
          </div>
        </Field>
      </Advanced>
    </>
  )
}
