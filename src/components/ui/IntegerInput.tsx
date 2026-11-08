import { useState } from 'react'
import { cn } from '@/lib/ui/cn'
import { controlBase, controlSize, type ControlSize } from '@/lib/ui/styles'
import { useFieldId } from './fieldContext'

interface IntegerInputProps {
  value: number
  onChange: (val: number) => void
  min?: number
  max?: number
  // Replaces the default control styling when given (older call sites).
  className?: string
  size?: ControlSize
  ariaLabel?: string
  id?: string
}

export function IntegerInput({ value, onChange, min, max, className, size = 'md', ariaLabel, id }: IntegerInputProps) {
  const fieldId = useFieldId(id)
  const [draft, setDraft] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)

  const display = focused && draft !== null ? draft : String(value)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
    setDraft(raw)
    if (raw === '') return
    const num = parseInt(raw, 10)
    if (min !== undefined && num < min) return
    if (max !== undefined && num > max) return
    onChange(num)
  }

  const handleBlur = () => {
    setFocused(false)
    if (draft === null || draft === '') {
      setDraft(null)
      return
    }
    const num = parseInt(draft, 10)
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, num))
    setDraft(null)
    if (clamped !== value) onChange(clamped)
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      value={display}
      onFocus={() => {
        setFocused(true)
        setDraft(String(value))
      }}
      onChange={handleChange}
      onBlur={handleBlur}
      aria-label={ariaLabel}
      autoComplete="off"
      id={fieldId}
      className={className ?? cn(controlBase, controlSize[size])}
    />
  )
}
