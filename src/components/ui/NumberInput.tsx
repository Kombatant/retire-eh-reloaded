import { useState, useMemo } from 'react'
import { formatCurrency } from '@/lib/formatting'
import { cn } from '@/lib/ui/cn'
import { controlBase, controlSize } from '@/lib/ui/styles'
import { useFieldId } from './fieldContext'

interface NumberInputProps {
  value: number
  onChange: (val: number) => void
  min?: number
  max?: number
  size?: 'default' | 'compact'
  ariaLabel?: string
  id?: string
  className?: string
}

// Dollar amount input: formatted with separators at rest, plain while editing.
export function NumberInput({ value, onChange, min, max, size = 'default', ariaLabel, id, className }: NumberInputProps) {
  const fieldId = useFieldId(id)
  const [focused, setFocused] = useState(false)

  const displayValue = useMemo(() => {
    if (value === 0) return ''
    return focused ? String(value) : formatCurrency(value)
  }, [value, focused])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[,$\s]/g, '')
    const num = parseFloat(raw) || 0
    if ((min === undefined || num >= min) && (max === undefined || num <= max)) onChange(num)
  }

  return (
    <div className={cn('relative min-w-0', className)}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-fg-muted">$</span>
      <input
        id={fieldId}
        type="text"
        inputMode="decimal"
        value={displayValue}
        placeholder="0"
        onChange={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoComplete="off"
        data-lpignore="true"
        aria-label={ariaLabel}
        className={cn(controlBase, size === 'compact' ? controlSize.sm : controlSize.md, 'pl-6 text-right')}
      />
    </div>
  )
}
