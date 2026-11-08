import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { cn } from '@/lib/ui/cn'

export type CalloutTone = 'info' | 'success' | 'warning' | 'danger'

const toneClass: Record<CalloutTone, string> = {
  info: 'border-border bg-surface-muted',
  success: 'border-success/30 bg-success-subtle',
  warning: 'border-warning/30 bg-warning-subtle',
  danger: 'border-danger/30 bg-danger-subtle',
}

const iconClass: Record<CalloutTone, string> = {
  info: 'text-fg-muted',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
}

const icons = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: XCircle }

// An inline message. Status is always carried by the icon and wording as well
// as colour.
export function Callout({ tone = 'info', title, children, actions, className }: {
  tone?: CalloutTone
  title?: ReactNode
  children?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  const Icon = icons[tone]
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : undefined}
      className={cn('flex flex-col gap-3 rounded-lg border px-3.5 py-3 text-sm sm:flex-row sm:items-start', toneClass[tone], className)}
    >
      <div className="flex min-w-0 flex-1 gap-2.5">
        <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', iconClass[tone])} aria-hidden />
        <div className="min-w-0 text-fg-secondary">
          {title && <div className="font-medium text-fg">{title}</div>}
          {children && <div className={title ? 'mt-0.5' : undefined}>{children}</div>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 gap-2 pl-6 sm:pl-0">{actions}</div>}
    </div>
  )
}
