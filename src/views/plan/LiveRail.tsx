import { useState } from 'react'
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronUp } from 'lucide-react'
import { useRoute } from '@/contexts/RouteContext'
import { usePlanOutlook } from '@/hooks/usePlanOutlook'
import { money, moneyCompact } from '@/lib/formatting'
import { cn } from '@/lib/ui/cn'
import { MoneyModeBadge } from '@/components/ui/Badge'
import { GoalProgress } from '@/components/GoalProgress'
import { moneyMode } from '@/lib/ui/money'

// The few numbers that answer "how is my plan doing?", kept beside the inputs
// so every edit shows its effect immediately.
function RailBody() {
  const o = usePlanOutlook()
  const { navigate } = useRoute()

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-medium text-fg-muted">Plan status</span>
          <MoneyModeBadge mode={moneyMode(o.showRealValues)} />
        </div>
        <div className={cn('mt-2 flex items-center gap-2 text-base font-semibold', o.outlook.onTrack ? 'text-success' : 'text-warning')}>
          {o.outlook.onTrack
            ? <CheckCircle2 className="h-5 w-5" aria-hidden />
            : <AlertTriangle className="h-5 w-5" aria-hidden />}
          {o.outlook.onTrack ? 'On track' : 'Short of your goal'}
        </div>
        <div className="mt-3">
          <GoalProgress outlook={o.outlook} barClassName="h-1.5" onTestRoom={() => navigate({ view: 'proposals' })} />
        </div>
        {!o.outlook.onTrack && o.outlook.extraSavingsNeeded > 0 && (
          <p className="mt-2 text-xs text-fg-secondary">
            Saving about <span className="font-medium text-fg">{money(o.outlook.extraSavingsNeeded)}</span> more per year would close the gap.
          </p>
        )}
      </div>

      <dl className="space-y-3.5 border-t border-border pt-4">
        <RailFigure label={`Savings at ${o.retirementAge}`} value={moneyCompact(o.portfolioAtRetirement)} />
        <RailFigure
          label="Retirement income after tax"
          value={`${money(o.outlook.afterTaxIncome)}/yr`}
          sub={`${money(o.outlook.afterTaxIncome / 12)}/month`}
        />
        <RailFigure
          label="Money lasts"
          value={o.lasts.wholePlan ? `Past age ${o.lasts.age}` : `Until age ${o.lasts.age}`}
          sub={o.lasts.wholePlan ? 'Savings last the whole plan' : `Savings run out in ${o.lasts.year}`}
          tone={o.lasts.wholePlan ? undefined : 'danger'}
        />
      </dl>

      <button
        type="button"
        onClick={() => navigate({ view: 'dashboard' })}
        className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:text-accent-hover"
      >
        View dashboard <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  )
}

function RailFigure({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'danger' }) {
  return (
    <div>
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className={cn('mt-0.5 text-lg font-semibold tracking-tight', tone === 'danger' ? 'text-danger' : 'text-fg')}>{value}</dd>
      {sub && <dd className="text-xs text-fg-muted">{sub}</dd>}
    </div>
  )
}

export function LiveRail() {
  return (
    <aside aria-label="Plan results" className="sticky top-[5.5rem] hidden w-72 shrink-0 self-start rounded-xl border border-border bg-surface p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] xl:block">
      <RailBody />
    </aside>
  )
}

// On narrower screens the rail collapses to a bar pinned to the bottom.
export function MobileSummaryBar() {
  const [open, setOpen] = useState(false)
  const o = usePlanOutlook()
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface shadow-[0_-4px_12px_rgba(16,24,40,0.06)] xl:hidden">
      {open && <div className="max-h-[60vh] overflow-y-auto px-4 pb-2 pt-4"><RailBody /></div>}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left"
      >
        {o.outlook.onTrack
          ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden />
          : <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden />}
        <span className="min-w-0 flex-1 truncate text-sm">
          <span className="font-medium text-fg">{o.outlook.noSavingsNeeded ? 'Goal met' : `${Math.round(o.outlook.progressPct)}% of goal`}</span>
          <span className="text-fg-muted"> · {money(o.outlook.afterTaxIncome)}/yr after tax</span>
        </span>
        <ChevronUp className={cn('h-4 w-4 shrink-0 text-fg-muted transition-transform', open ? 'rotate-0' : 'rotate-180')} aria-hidden />
        <span className="sr-only">{open ? 'Hide plan results' : 'Show plan results'}</span>
      </button>
    </div>
  )
}
