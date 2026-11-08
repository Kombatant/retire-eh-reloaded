import type { ReactNode } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useRoute } from '@/contexts/RouteContext'
import { isPlanSection, type PlanSection } from '@/lib/ui/route'
import { cn } from '@/lib/ui/cn'
import { PLAN_SECTION_META } from '@/components/layout/navItems'
import { LiveRail, MobileSummaryBar } from './LiveRail'
import { AdvancedNotice } from './AdvancedNotice'
import { HouseholdSection } from './sections/HouseholdSection'
import { SavingsSection } from './sections/SavingsSection'
import { IncomeSection } from './sections/IncomeSection'
import { SpendingSection } from './sections/SpendingSection'
import { PropertySection } from './sections/PropertySection'
import { WithdrawalsSection } from './sections/WithdrawalsSection'
import { AssumptionsSection } from './sections/AssumptionsSection'

const SECTIONS: Record<PlanSection, () => ReactNode> = {
  household: () => <HouseholdSection />,
  savings: () => <SavingsSection />,
  income: () => <IncomeSection />,
  spending: () => <SpendingSection />,
  property: () => <PropertySection />,
  withdrawals: () => <WithdrawalsSection />,
  assumptions: () => <AssumptionsSection />,
}

// The plan editor: one section at a time, with live results alongside.
export function PlanView() {
  const { route, navigate } = useRoute()
  const section: PlanSection = isPlanSection(route.sub) ? route.sub : 'household'
  const index = PLAN_SECTION_META.findIndex(s => s.id === section)
  const meta = PLAN_SECTION_META[index]
  const prev = PLAN_SECTION_META[index - 1]
  const next = PLAN_SECTION_META[index + 1]

  return (
    <div className="flex items-start gap-8 pb-20 xl:pb-0">
      <div className="min-w-0 flex-1">
        {/* Section chips stand in for the sidebar on small screens. */}
        <nav aria-label="Plan sections" className="scrollbar-hide -mx-4 mb-5 flex gap-1.5 overflow-x-auto px-4 lg:hidden">
          {PLAN_SECTION_META.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => navigate({ view: 'plan', sub: s.id })}
              aria-current={s.id === section ? 'step' : undefined}
              className={cn(
                'h-8 shrink-0 rounded-full border px-3 text-[13px] font-medium',
                s.id === section ? 'border-accent bg-accent-subtle text-accent' : 'border-border bg-surface text-fg-secondary',
              )}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <header className="mb-6">
          <p className="text-[13px] font-medium text-fg-muted">Plan · Step {index + 1} of {PLAN_SECTION_META.length}</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-fg sm:text-2xl">{meta.label}</h1>
          <p className="mt-1 text-sm text-fg-muted">{meta.description}</p>
        </header>

        <div className="space-y-5">
          <AdvancedNotice section={section} />
          {SECTIONS[section]()}
        </div>

        <div className="mt-8 flex items-center justify-between gap-4 border-t border-border pt-5">
          {prev ? (
            <button
              type="button"
              onClick={() => navigate({ view: 'plan', sub: prev.id })}
              className="inline-flex min-h-[40px] items-center gap-1.5 text-sm font-medium text-fg-secondary hover:text-fg"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden /> {prev.label}
            </button>
          ) : <span />}
          {next ? (
            <button
              type="button"
              onClick={() => navigate({ view: 'plan', sub: next.id })}
              className="inline-flex h-10 items-center gap-1.5 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover"
            >
              Next: {next.label} <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => navigate({ view: 'dashboard' })}
              className="inline-flex h-10 items-center gap-1.5 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover"
            >
              See your results <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
      </div>
      <LiveRail />
      <MobileSummaryBar />
    </div>
  )
}
