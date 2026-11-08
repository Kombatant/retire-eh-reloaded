import type { ReactNode } from 'react'
import { cn } from '@/lib/ui/cn'
import { InfoTooltip } from './InfoTooltip'

export type StatTone = 'default' | 'success' | 'warning' | 'danger'

const toneClass: Record<StatTone, string> = {
  default: 'text-fg',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
}

interface StatProps {
  label: ReactNode
  value: ReactNode
  sub?: ReactNode
  info?: string
  tone?: StatTone
  size?: 'md' | 'lg'
  // Render without its own frame, for use inside a card that already has one.
  bare?: boolean
  className?: string
}

// The single KPI tile style used everywhere.
export function Stat({ label, value, sub, info, tone = 'default', size = 'md', bare, className }: StatProps) {
  return (
    <div className={cn(!bare && 'rounded-xl border border-border bg-surface p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]', 'min-w-0', className)}>
      <div className="flex items-center gap-1 text-[13px] font-medium text-fg-muted">
        <span className="truncate">{label}</span>
        {info && <InfoTooltip text={info} />}
      </div>
      <div className={cn('mt-1.5 font-semibold tracking-tight', size === 'lg' ? 'text-3xl' : 'text-2xl', toneClass[tone])}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-fg-muted">{sub}</div>}
    </div>
  )
}
