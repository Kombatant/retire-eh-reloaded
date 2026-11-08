import { useState } from 'react'
import { Check, Copy, Lightbulb } from 'lucide-react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { useRoute } from '@/contexts/RouteContext'
import { useToast } from '@/contexts/ToastContext'
import { useProposals } from '@/hooks/useProposals'
import { applyChanges, TARGET_SUCCESS, type PlanScore, type Proposal, type ProposalGroup } from '@/lib/insights/proposals'
import { newId } from '@/lib/plan/ids'
import type { PlanV2 } from '@/lib/plan/schema'
import { moneyCompact } from '@/lib/formatting'
import { cn } from '@/lib/ui/cn'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardHeader } from '@/components/ui/Card'
import { MoneyModeBadge, Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Stat } from '@/components/ui/Stat'
import { Callout } from '@/components/ui/Callout'
import { EmptyState } from '@/components/ui/EmptyState'
import { moneyDelta, pct, TARGET_PCT, TONE, type DeltaView } from './format'
import { RetirementTimingCard } from './RetirementTimingCard'
import { TestingProgress } from './TestingProgress'

function deltas(base: PlanScore, s: PlanScore): DeltaView[] {
  const out: DeltaView[] = []
  if (!base.onTrack) {
    const points = Math.round(s.goalProgressPct) - Math.round(base.goalProgressPct)
    out.push({
      label: 'Goal progress',
      text: points === 0 ? `Stays at ${Math.round(s.goalProgressPct)}%` : `${Math.round(s.goalProgressPct)}% (${Math.abs(points)} pts ${points > 0 ? 'higher' : 'lower'})`,
      tone: points === 0 ? 'none' : points > 0 ? 'good' : 'bad',
    })
  }
  if (base.successRate !== null && s.successRate !== null) {
    const points = Math.round((s.successRate - base.successRate) * 100)
    out.push({
      label: 'Chance of success',
      text: points === 0 ? `Stays at ${pct(s.successRate)}` : `${pct(s.successRate)} (${Math.abs(points)} pts ${points > 0 ? 'higher' : 'lower'})`,
      tone: points === 0 ? 'none' : points > 0 ? 'good' : 'bad',
    })
  }
  out.push(moneyDelta('Lifetime tax', s.lifetimeTax - base.lifetimeTax, false))
  out.push(moneyDelta('Estate after tax', s.afterTaxEstate - base.afterTaxEstate, true))
  out.push(moneyDelta('Yearly income after tax', s.averageIncome - base.averageIncome, true))
  return out
}

function ProposalBody({ proposal, base, onApply, onCopy }: {
  proposal: Proposal
  base: PlanScore
  onApply: (p: Proposal) => void
  onCopy: (p: Proposal) => void
}) {
  const rows = deltas(base, proposal.score)
  return (
    <div className="space-y-3">
      <dl className={cn('grid grid-cols-2 gap-x-4 gap-y-2', rows.length > 4 ? 'lg:grid-cols-5' : 'lg:grid-cols-4')}>
        {rows.map(d => (
          <div key={d.label} className="min-w-0">
            <dt className="text-xs text-fg-muted">{d.label}</dt>
            <dd className={cn('text-sm font-medium', TONE[d.tone])}>{d.text}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={Copy} onClick={() => onCopy(proposal)}>Try as a new plan</Button>
        <Button size="sm" variant="ghost" icon={Check} onClick={() => onApply(proposal)}>Apply to this plan</Button>
      </div>
    </div>
  )
}

function ProposalRow(props: Parameters<typeof ProposalBody>[0]) {
  const { proposal } = props
  const successShort = proposal.score.successRate !== null && proposal.score.successRate < TARGET_SUCCESS
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="mb-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-fg">{proposal.title}</h3>
          {proposal.reachesTarget === false && <Badge tone="warning">{successShort ? `Still short of ${TARGET_PCT}%` : 'Goal not reached yet'}</Badge>}
        </div>
        <p className="mt-0.5 text-[13px] text-fg-muted">{proposal.detail}</p>
      </div>
      <ProposalBody {...props} />
    </li>
  )
}

const GROUPS: { group: ProposalGroup; title: string; description: (needGoal: boolean) => string }[] = [
  {
    group: 'free',
    title: 'Changes that cost you nothing',
    description: () => 'Same savings and same spending. Only how and when the money moves is different.',
  },
  {
    group: 'tradeoff',
    title: 'Trade-offs',
    description: needGoal => `The smallest change of each kind that reaches a ${TARGET_PCT}% chance of success${needGoal ? ' and your goal' : ''}.`,
  },
  {
    group: 'spare',
    title: 'Room to spare',
    description: () => `You are past ${TARGET_PCT}%. The furthest each change can go while staying there.`,
  },
]

export function ProposalsView() {
  const { activePlan, nowYear, updateActivePlan, updatePlan, addPlan } = usePlanStore()
  const { navigate } = useRoute()
  const { notify } = useToast()
  const state = useProposals()
  const [applied, setApplied] = useState<{ planId: string; before: PlanV2; title: string } | null>(null)

  const apply = (p: Proposal) => {
    setApplied({ planId: activePlan.id, before: activePlan, title: p.title })
    updateActivePlan(plan => applyChanges(plan, p.changes, nowYear))
  }
  const undo = () => {
    if (!applied) return
    updatePlan(applied.planId, () => applied.before)
    setApplied(null)
  }
  const copy = (p: Proposal) => {
    const name = `${activePlan.name}: ${p.title}`
    addPlan({ ...applyChanges(structuredClone(activePlan), p.changes, nowYear), id: newId('plan'), name })
    notify(`Saved and opened “${name}”. Your original plan is unchanged.`)
    navigate({ view: 'compare' })
  }

  const { base, proposals = [], running, tested = 0, runs, progress = 0, error } = state
  const combo = proposals.find(p => p.group === 'combo')
  const needGoal = base ? !base.onTrack : false
  const shared = base ? { base, onApply: apply, onCopy: copy } : null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Proposals"
        description="Changes to your plan, each tested by re-running the whole plan on the same simulated markets."
        meta={<MoneyModeBadge mode="fixedReal" />}
      />

      {applied && (
        <Callout tone="success" title={`Applied: ${applied.title}`} actions={<Button size="sm" onClick={undo}>Undo</Button>}>
          Your plan has been updated and the proposals are being tested again.
        </Callout>
      )}

      {error && <Callout tone="danger" title="Something went wrong">{error}</Callout>}

      {base && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Chance of success" value={pct(base.successRate)} sub={base.successRate === null ? 'No withdrawals to test' : 'Across simulated markets'} />
          <Stat label="Goal progress" value={`${Math.round(base.goalProgressPct)}%`} sub={base.onTrack ? 'On track' : 'Not on track yet'} />
          <Stat label="Lifetime tax" value={moneyCompact(base.lifetimeTax)} sub="At expected returns" />
          <Stat label="Estate after tax" value={moneyCompact(base.afterTaxEstate)} sub="At expected returns" />
        </div>
      )}

      <RetirementTimingCard onApply={apply} onCopy={copy} />

      {running && <TestingProgress label="Testing changes to your plan…" detail={`${tested} tested`} progress={progress} />}

      {combo && shared && (
        <Card padding="lg">
          <CardHeader title={combo.title} description={combo.detail} icon={Lightbulb} />
          <ProposalBody proposal={combo} {...shared} />
        </Card>
      )}

      {shared && GROUPS.map(({ group, title, description }) => {
        const items = proposals.filter(p => p.group === group)
        if (items.length === 0) return null
        return (
          <Card key={group}>
            <CardHeader title={title} description={description(needGoal)} />
            <ul className="divide-y divide-border">
              {items.map(p => <ProposalRow key={p.id} proposal={p} {...shared} />)}
            </ul>
          </Card>
        )
      })}

      {!running && !error && base && proposals.length === 0 && (
        <Card>
          <EmptyState
            icon={Lightbulb}
            title="Nothing beat your current plan"
            description={`We tested ${tested} changes, and none improved it by a meaningful margin.`}
          />
        </Card>
      )}

      {!running && !error && base && (
        <p className="text-xs text-fg-muted">
          {tested} changes tested{runs ? ` on ${runs.toLocaleString('en-CA')} simulated markets each` : ''}. Tax and estate figures use your expected returns.
          These are estimates from your plan’s assumptions, not financial advice.
        </p>
      )}
    </div>
  )
}
