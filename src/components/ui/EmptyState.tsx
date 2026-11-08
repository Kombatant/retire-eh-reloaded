import type { ComponentType, ReactNode } from 'react'

export function EmptyState({ icon: Icon, title, description, action }: {
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      {Icon && (
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface-muted">
          <Icon className="h-5 w-5 text-fg-muted" aria-hidden />
        </div>
      )}
      <div className="text-sm font-medium text-fg">{title}</div>
      {description && <p className="mt-1 max-w-sm text-[13px] text-fg-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
