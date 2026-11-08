import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/ui/cn'
import { hintClass, labelClass } from '@/lib/ui/styles'
import { FieldIdContext } from './fieldContext'
import { InfoTooltip } from './InfoTooltip'

interface FieldProps {
  label: ReactNode
  hint?: ReactNode
  info?: string
  error?: ReactNode
  className?: string
  children: ReactNode
}

// Label + control + hint/error, in one consistent block.
export function Field({ label, hint, info, error, className, children }: FieldProps) {
  const id = useId()
  return (
    <div className={cn('min-w-0', className)}>
      <div className="mb-1.5 flex items-center gap-1">
        <label htmlFor={id} className={labelClass}>{label}</label>
        {info && <InfoTooltip text={info} />}
      </div>
      <FieldIdContext.Provider value={id}>{children}</FieldIdContext.Provider>
      {error ? (
        <p className="mt-1 text-xs text-danger" role="alert">{error}</p>
      ) : hint ? (
        <p className={cn('mt-1', hintClass)}>{hint}</p>
      ) : null}
    </div>
  )
}

// Visual grouping for a set of fields inside a card or sheet.
export function FieldGroup({ title, description, children, className }: {
  title?: ReactNode
  description?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <fieldset className={cn('min-w-0 space-y-4', className)}>
      {title && (
        <legend className="mb-3">
          <span className="text-[13px] font-semibold text-fg">{title}</span>
          {description && <span className="mt-0.5 block text-xs text-fg-muted">{description}</span>}
        </legend>
      )}
      {children}
    </fieldset>
  )
}
