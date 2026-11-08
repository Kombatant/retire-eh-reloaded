import { useState } from 'react'
import { cn } from '@/lib/ui/cn'
import { controlBase, controlSize } from '@/lib/ui/styles'
import { useFieldId } from './fieldContext'

interface NumberInputProps {
  value: number
  onChange: (val: number) => void
  min?: number
  max?: number
  // Digits allowed after the decimal point (cents by default).
  decimals?: number
  // Currency marker inside the left edge.
  prefix?: string
  size?: 'default' | 'compact'
  ariaLabel?: string
  id?: string
  className?: string
}

function formatAtRest(value: number, decimals: number): string {
  if (value === 0) return ''
  const fractional = !Number.isInteger(value) && decimals > 0
  return value.toLocaleString('en-CA', {
    minimumFractionDigits: fractional ? Math.min(2, decimals) : 0,
    maximumFractionDigits: decimals,
  })
}

// Money input: formatted with separators at rest, plain while editing.
// It keeps what the user typed while focused, so "12." survives until the
// next digit instead of snapping back to "12".
export function NumberInput({
  value, onChange, min, max, decimals = 2, prefix = '$', size = 'default', ariaLabel, id, className,
}: NumberInputProps) {
  const fieldId = useFieldId(id)
  const [draft, setDraft] = useState<string | null>(null)
  const allowNegative = min === undefined || min < 0
  const pattern = new RegExp(`^${allowNegative ? '-?' : ''}\\d*${decimals > 0 ? `(\\.\\d{0,${decimals}})?` : ''}$`)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[,$\s]/g, '')
    if (!pattern.test(raw)) return
    setDraft(raw)
    const num = parseFloat(raw)
    const next = Number.isFinite(num) ? num : 0
    if ((min === undefined || next >= min) && (max === undefined || next <= max)) onChange(next)
  }

  return (
    <div className={cn('relative min-w-0', className)}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-fg-muted">{prefix}</span>
      <input
        id={fieldId}
        type="text"
        inputMode="decimal"
        value={draft ?? formatAtRest(value, decimals)}
        placeholder="0"
        onChange={handleChange}
        onFocus={() => setDraft(value === 0 ? '' : String(value))}
        onBlur={() => setDraft(null)}
        autoComplete="off"
        data-lpignore="true"
        aria-label={ariaLabel}
        className={cn(controlBase, size === 'compact' ? controlSize.sm : controlSize.md, prefix.length > 1 ? 'pl-11' : 'pl-6', 'text-right')}
      />
    </div>
  )
}
