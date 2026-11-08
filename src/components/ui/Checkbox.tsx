import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/ui/cn'

interface CheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
  className?: string
}

export function Checkbox({ checked, onChange, label, description, disabled, className }: CheckboxProps) {
  const id = useId()
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={description ? `${id}-desc` : undefined}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-border-strong"
      />
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm text-fg">{label}</label>
        {description && <p id={`${id}-desc`} className="mt-0.5 text-xs text-fg-muted">{description}</p>}
      </div>
    </div>
  )
}

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  description?: ReactNode
  className?: string
}

export function Switch({ checked, onChange, label, description, className }: SwitchProps) {
  const id = useId()
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm text-fg">{label}</label>
        {description && <p id={`${id}-desc`} className="mt-0.5 text-xs text-fg-muted">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-desc` : undefined}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
          checked ? 'bg-accent' : 'bg-border-strong',
        )}
      >
        <span
          className={cn(
            'inline-block h-4 w-4 rounded-full bg-surface shadow transition-transform',
            checked ? 'translate-x-[18px]' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  )
}
