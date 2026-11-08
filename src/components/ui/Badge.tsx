import type { ReactNode } from 'react'
import { cn } from '@/lib/ui/cn'

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

const toneClass: Record<BadgeTone, string> = {
  neutral: 'bg-surface-muted text-fg-secondary ring-border',
  accent: 'bg-accent-subtle text-accent ring-accent/25',
  success: 'bg-success-subtle text-success ring-success/25',
  warning: 'bg-warning-subtle text-warning ring-warning/25',
  danger: 'bg-danger-subtle text-danger ring-danger/25',
}

export function Badge({ tone = 'neutral', children, className, title }: {
  tone?: BadgeTone
  children: ReactNode
  className?: string
  title?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        toneClass[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

// Which kind of dollars a view shows.
//  real    – follows the toggle, currently today's dollars
//  nominal – follows the toggle, currently future dollars
//  fixedReal / fixedNominal – this view always uses one kind, whatever the toggle says
export type MoneyMode = 'real' | 'nominal' | 'fixedReal' | 'fixedNominal'

export function MoneyModeBadge({ mode }: { mode: MoneyMode }) {
  const label = mode === 'real' ? "Today's dollars"
    : mode === 'nominal' ? 'Future dollars'
      : mode === 'fixedReal' ? "Always today's dollars"
        : 'Always future dollars'
  const title = mode === 'real' || mode === 'fixedReal'
    ? 'Amounts are in today’s purchasing power (inflation removed).'
    : 'Amounts are the dollars of each future year (inflation included).'
  return <Badge tone="neutral" title={title}>{label}</Badge>
}
