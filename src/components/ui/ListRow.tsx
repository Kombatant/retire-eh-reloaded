import type { ReactNode } from 'react'
import { ChevronRight, Trash2 } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { IconButton } from './Button'

interface ListRowProps {
  title: ReactNode
  // Small line under the title (owner, dates, type).
  subtitle?: ReactNode
  // Leading badge or swatch.
  leading?: ReactNode
  // Right-aligned key figures.
  value?: ReactNode
  valueSub?: ReactNode
  onOpen?: () => void
  openLabel?: string
  onRemove?: () => void
  removeLabel?: string
  className?: string
}

// One item in an editable list: a compact summary that opens a sheet with the
// full editor. Keeps long lists scannable instead of showing every field.
export function ListRow({
  title, subtitle, leading, value, valueSub, onOpen, openLabel, onRemove, removeLabel = 'Remove', className,
}: ListRowProps) {
  const body = (
    <>
      {leading && <div className="shrink-0">{leading}</div>}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-fg">{title}</div>
        {subtitle && <div className="mt-0.5 truncate text-xs text-fg-muted">{subtitle}</div>}
      </div>
      {(value !== undefined || valueSub) && (
        <div className="shrink-0 text-right">
          {value !== undefined && <div className="text-sm font-medium text-fg">{value}</div>}
          {valueSub && <div className="mt-0.5 text-xs text-fg-muted">{valueSub}</div>}
        </div>
      )}
    </>
  )

  return (
    <div className={cn('group flex items-center gap-1 border-b border-border last:border-b-0', className)}>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={openLabel}
          className="flex min-h-[56px] min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-2.5 text-left hover:bg-surface-muted"
        >
          {body}
          <ChevronRight className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
        </button>
      ) : (
        <div className="flex min-h-[56px] min-w-0 flex-1 items-center gap-3 px-2 py-2.5">{body}</div>
      )}
      {onRemove && (
        <IconButton
          icon={Trash2}
          label={removeLabel}
          size="sm"
          onClick={onRemove}
          className="text-fg-muted opacity-70 hover:text-danger group-hover:opacity-100"
        />
      )}
    </div>
  )
}

// Container for ListRows with a consistent frame.
export function ListFrame({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-lg border border-border px-1', className)}>{children}</div>
}
