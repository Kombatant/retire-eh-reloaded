import { forwardRef, useState, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { controlBase, controlSize, type ControlSize } from '@/lib/ui/styles'
import { useFieldId } from './fieldContext'

interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: ControlSize
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { size = 'md', className, id, type = 'text', ...rest },
  ref,
) {
  const fieldId = useFieldId(id)
  return <input ref={ref} id={fieldId} type={type} className={cn(controlBase, controlSize[size], className)} {...rest} />
})

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: ControlSize
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { size = 'md', className, id, children, ...rest },
  ref,
) {
  const fieldId = useFieldId(id)
  return (
    <div className={cn('relative min-w-0', className)}>
      <select
        ref={ref}
        id={fieldId}
        className={cn(controlBase, controlSize[size], 'appearance-none pr-8')}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" aria-hidden />
    </div>
  )
})

interface DecimalInputProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  // Text shown inside the right edge, e.g. '%' or 'yrs'.
  suffix?: string
  size?: ControlSize
  ariaLabel?: string
  id?: string
  className?: string
  disabled?: boolean
  placeholder?: string
}

// A free-form decimal input. It keeps what the user typed while focused (so
// "4." or "-" are allowed mid-edit) and only reports finite numbers.
export function DecimalInput({
  value, onChange, min, max, suffix, size = 'md', ariaLabel, id, className, disabled, placeholder,
}: DecimalInputProps) {
  const fieldId = useFieldId(id)
  const [draft, setDraft] = useState<string | null>(null)

  const handleChange = (raw: string) => {
    setDraft(raw)
    const parsed = parseFloat(raw)
    if (!Number.isFinite(parsed)) return
    if (min !== undefined && parsed < min) return
    if (max !== undefined && parsed > max) return
    onChange(parsed)
  }

  return (
    <div className={cn('relative min-w-0', className)}>
      <input
        id={fieldId}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={draft ?? String(value)}
        onFocus={() => setDraft(String(value))}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => setDraft(null)}
        aria-label={ariaLabel}
        disabled={disabled}
        placeholder={placeholder}
        className={cn(controlBase, controlSize[size], suffix && 'pr-9')}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-fg-muted">{suffix}</span>
      )}
    </div>
  )
}

export function PercentInput(props: Omit<DecimalInputProps, 'suffix'>) {
  return <DecimalInput {...props} suffix="%" />
}
