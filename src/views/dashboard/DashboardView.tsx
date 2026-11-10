import { useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, ArrowRight, Check, CheckCircle2, Copy, Pencil } from 'lucide-react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { useRoute } from '@/contexts/RouteContext'
import { useProjectionContext } from '@/contexts/ProjectionContext'
import { useAssumptions } from '@/contexts/AssumptionsContext'
import { usePlanOutlook } from '@/hooks/usePlanOutlook'
import { usePlanNarrative } from '@/hooks/usePlanNarrative'
import { useRiskAnalysis } from '@/hooks/useRiskAnalysis'
import { retirementIncomeSources, type IncomeSourceKey } from '@/lib/insights/outlook'
import { successIsMeaningful } from '@/lib/sim/risk'
import { buildMilestones, type Milestone } from '@/lib/insights/milestones'
import { fiMetrics } from '@/lib/insights/fi'
import { money, moneyCompact } from '@/lib/formatting'
import { axisProps, chartColors, gridProps, tooltipProps } from '@/lib/ui/chartTheme'
import { moneyMode } from '@/lib/ui/money'
import { cn } from '@/lib/ui/cn'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardHeader } from '@/components/ui/Card'
import { Stat } from '@/components/ui/Stat'
import { Button } from '@/components/ui/Button'
import { MoneyModeBadge } from '@/components/ui/Badge'
import { Disclosure } from '@/components/ui/Disclosure'
import { GoalProgress } from '@/components/GoalProgress'

export function DashboardView() {
  const { activePlan } = usePlanStore()
  const { navigate } = useRoute()
  const o = usePlanOutlook()
  const names = activePlan.people.map(p => p.name).join(' & ')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={`${activePlan.name} · ${names}`}
        meta={<MoneyModeBadge mode={moneyMode(o.showRealValues)} />}
        actions={<Button size="sm" icon={Pencil} onClick={() => navigate({ view: 'plan', sub: 'household' })}>Edit plan</Button>}
      />

      <StatusHero />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Savings today" value={moneyCompact(o.portfolioToday)} sub="All accounts" />
        <Stat
          label={`Savings at ${o.retirementAge}`}
          value={moneyCompact(o.portfolioAtRetirement)}
          sub={o.yearsToRetirement > 0 ? `In ${o.yearsToRetirement} years` : 'Retired'}
        />
        <Stat
          label="Income in retirement"
          value={moneyCompact(o.outlook.afterTaxIncome)}
          sub={`${money(o.outlook.afterTaxIncome / 12)}/month after tax`}
        />
        <Stat
          label="Money lasts"
          value={o.lasts.wholePlan ? `Age ${o.lasts.age}+` : `Age ${o.lasts.age}`}
          tone={o.lasts.wholePlan ? 'default' : 'danger'}
          sub={o.lasts.wholePlan
            ? (o.estateValue !== null ? `${moneyCompact(o.estateValue)} left to heirs` : 'Whole plan funded')
            : o.lasts.note}
        />
      </div>

      <LifetimeChart />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <IncomeSourcesCard />
        <MilestonesTimeline />
      </div>

      <PlanSummary />
    </div>
  )
}

function StatusHero() {
  const { navigate } = useRoute()
  const o = usePlanOutlook()
  const risk = useRiskAnalysis()
  const { compiledPlan, simulation } = useProjectionContext()
  const testable = successIsMeaningful(compiledPlan, simulation)
  const success = risk.monteCarlo ? Math.round(risk.monteCarlo.successRate * 100) : null
  const target = o.goal.requiredAnnualIncome
  const onTrack = o.outlook.onTrack

  return (
    <Card padding="lg">
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <div className={cn('flex items-center gap-2 text-lg font-semibold', onTrack ? 'text-success' : 'text-warning')}>
            {onTrack ? <CheckCircle2 className="h-5 w-5" aria-hidden /> : <AlertTriangle className="h-5 w-5" aria-hidden />}
            {o.outlook.needsTarget ? 'Set an income target' : onTrack ? "You're on track" : 'Your plan runs short'}
          </div>
          <p className="mt-1 text-sm text-fg-secondary">
            From age {o.retirementAge}, your plan provides <span className="font-medium text-fg">{money(o.outlook.preTaxIncome)}</span> a year
            before tax (<span className="font-medium text-fg">{money(o.outlook.afterTaxIncome)}</span> after tax), levelized over retirement. Your goal is{' '}
            <span className="font-medium text-fg">{money(target)}</span> {o.goalIsAfterTax ? 'after tax' : 'before tax'}.
          </p>
          <div className="mt-4 max-w-xl">
            <GoalProgress outlook={o.outlook} barClassName="h-2" />
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-3 md:items-end md:text-right">
          <button type="button" onClick={() => navigate({ view: 'risk' })} className="group text-left md:text-right">
            <div className="text-[13px] font-medium text-fg-muted">Chance of success</div>
            {!testable ? (
              <div className="mt-1 text-sm text-fg-muted">No withdrawals to test</div>
            ) : success === null ? (
              <div className="mt-1 text-sm text-fg-muted" role="status">Calculating…</div>
            ) : (
              <>
                <div className="text-2xl font-semibold tracking-tight text-fg group-hover:text-accent">{success}%</div>
                <div className="text-xs text-fg-muted">across simulated markets</div>
              </>
            )}
          </button>
          {!onTrack && !o.outlook.needsTarget && o.outlook.extraSavingsNeeded > 0 && (
            <Button size="sm" variant="primary" onClick={() => navigate({ view: 'plan', sub: 'savings' })}>
              Save {money(o.outlook.extraSavingsNeeded)} more a year <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Button>
          )}
          <Button size="sm" onClick={() => navigate({ view: 'proposals' })}>
            See proposals <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </div>
    </Card>
  )
}

// Savings across the whole plan: growth while working, drawdown after.
function LifetimeChart() {
  const { simulation, minCurrentAge, householdRetirementAge } = useProjectionContext()
  const { showRealValues } = useAssumptions()
  const { activePlan } = usePlanStore()
  const hasProperty = activePlan.properties.length > 0

  const data = useMemo(() => simulation.rows.map(r => {
    const scale = showRealValues ? 1 / r.cpiEnd : 1
    const savings = r.balancesEnd.reduce((s, b) => s + b, 0) * scale
    return {
      age: minCurrentAge + r.offset,
      year: r.year,
      savings: Math.max(0, savings),
      netWorth: r.netWorth * scale,
    }
  }), [simulation.rows, showRealValues, minCurrentAge])

  const depletion = simulation.depletionOffset !== null ? minCurrentAge + simulation.depletionOffset : null

  return (
    <Card>
      <CardHeader
        title="Your savings over time"
        description={hasProperty ? 'Investments by age, with net worth including your home and debts.' : 'All accounts combined, by age of the youngest person.'}
      />
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="savingsFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chartColors.base} stopOpacity={0.22} />
                <stop offset="100%" stopColor={chartColors.base} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="age" {...axisProps} interval="preserveStartEnd" minTickGap={24} />
            <YAxis {...axisProps} width={56} tickFormatter={(v: number) => moneyCompact(v)} />
            <Tooltip
              {...tooltipProps}
              labelFormatter={(age, payload) => `Age ${age} · ${payload?.[0]?.payload?.year ?? ''}`}
              formatter={(value, name) => [money(Number(value)), name === 'netWorth' ? 'Net worth' : 'Savings']}
            />
            <ReferenceLine x={householdRetirementAge} stroke={chartColors.reference} strokeDasharray="4 4" label={{ value: 'Retire', position: 'insideTopLeft', fill: chartColors.axis, fontSize: 12 }} />
            {depletion !== null && (
              <ReferenceLine x={depletion} stroke={chartColors.bad} strokeDasharray="4 4" label={{ value: 'Runs out', position: 'insideTopRight', fill: chartColors.bad, fontSize: 12 }} />
            )}
            {hasProperty && (
              <Area type="monotone" dataKey="netWorth" stroke={chartColors.reference} strokeWidth={1.5} strokeDasharray="3 3" fill="none" isAnimationActive={false} />
            )}
            <Area type="monotone" dataKey="savings" stroke={chartColors.base} strokeWidth={2} fill="url(#savingsFill)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {hasProperty && (
        <div className="mt-3 flex gap-5 text-xs text-fg-secondary">
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: chartColors.base }} />Savings</span>
          <span className="flex items-center gap-1.5"><span className="h-0 w-4 border-t border-dashed" style={{ borderColor: chartColors.reference }} />Net worth</span>
        </div>
      )}
    </Card>
  )
}

const SOURCE_META: Record<IncomeSourceKey, { label: string; color: string; help: string }> = {
  withdrawals: { label: 'From savings', color: chartColors.withdrawals, help: 'Sustainable withdrawal' },
  cpp: { label: 'CPP / QPP', color: chartColors.cpp, help: 'From your chosen start age' },
  oas: { label: 'OAS', color: chartColors.oas, help: 'From your chosen start age' },
  gis: { label: 'GIS', color: chartColors.gis, help: 'Income-tested top-up to OAS' },
  pension: { label: 'Workplace pension', color: chartColors.pension, help: 'Defined benefit' },
}

function IncomeSourcesCard() {
  const { activePlan } = usePlanStore()
  const projection = useProjectionContext()
  const assumptions = useAssumptions()
  const o = usePlanOutlook()
  const sources = retirementIncomeSources({
    // The goal's figure, so a later property sale counts here too.
    portfolioAfterGifts: o.goal.portfolioAfterGifts,
    withdrawalRatePct: assumptions.withdrawalRate,
    annualCpp: projection.totalAnnualCpp,
    annualOas: projection.totalAnnualOas,
    annualGis: projection.totalAnnualGis,
    annualPension: projection.totalAnnualPension,
    showRealValues: assumptions.showRealValues,
    inflationRatePct: assumptions.inflationRate,
    yearsToRetirement: projection.yearsToRetirement,
  })
  const total = sources.reduce((s, x) => s + x.amount, 0)
  const strategy = activePlan.drawdown.strategy.kind
  const baseNote = strategy === 'expenses' || strategy === 'vpw'
    ? `${assumptions.withdrawalRate}% of savings, as a guideline. Your strategy sets the actual amount.`
    : `${assumptions.withdrawalRate}% of savings`
  const withdrawalNote = o.goal.propertySaleValue > 0 ? `${baseNote} Includes a planned property sale.` : baseNote

  return (
    <Card>
      <CardHeader title="Retirement income sources" description={`First full year of retirement, before tax: ${money(total)} a year.`} />
      {total > 0 && (
        <div className="mb-5 flex h-3 gap-0.5 overflow-hidden rounded-full" aria-hidden>
          {sources.map(s => <div key={s.key} style={{ width: `${(s.amount / total) * 100}%`, background: SOURCE_META[s.key].color }} />)}
        </div>
      )}
      <ul className="divide-y divide-border">
        {sources.map(s => (
          <li key={s.key} className="flex items-center gap-3 py-2.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SOURCE_META[s.key].color }} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-fg">{SOURCE_META[s.key].label}</div>
              <div className="text-xs text-fg-muted">{s.key === 'withdrawals' ? withdrawalNote : SOURCE_META[s.key].help}</div>
            </div>
            <div className="text-right">
              <div className="text-sm font-medium text-fg">{money(s.amount)}</div>
              <div className="text-xs text-fg-muted">{total > 0 ? Math.round((s.amount / total) * 100) : 0}%</div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

const MILESTONE_DOT: Record<Milestone['kind'], string> = {
  retire: 'bg-accent',
  benefit: 'bg-fg-muted',
  rrif: 'bg-fg-muted',
  debt: 'bg-success',
  home: 'bg-fg-muted',
  fi: 'bg-success',
  risk: 'bg-danger',
  life: 'bg-border-strong',
}

function MilestonesTimeline() {
  const { activePlan, nowYear } = usePlanStore()
  const { compiledPlan, simulation } = useProjectionContext()
  const fi = useMemo(() => fiMetrics(activePlan, nowYear), [activePlan, nowYear])
  const milestones = useMemo(() => buildMilestones(activePlan, compiledPlan, simulation, fi), [activePlan, compiledPlan, simulation, fi])

  return (
    <Card>
      <CardHeader title="Milestones" description="Key dates on your plan's timeline." />
      <ol className="space-y-0">
        {milestones.map((m, i) => (
          <li key={`${m.year}-${m.label}`} className="relative flex gap-3 pb-3 last:pb-0">
            {i < milestones.length - 1 && <span className="absolute left-[4.5px] top-3 h-full w-px bg-border" aria-hidden />}
            <span className={cn('relative mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-surface', MILESTONE_DOT[m.kind])} aria-hidden />
            <span className="w-11 shrink-0 text-sm font-medium text-fg">{m.year}</span>
            <span className={cn('text-sm', m.kind === 'risk' ? 'font-medium text-danger' : 'text-fg-secondary')}>{m.label}</span>
          </li>
        ))}
      </ol>
    </Card>
  )
}

function PlanSummary() {
  const { narrative } = usePlanNarrative()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText([narrative.headline, ...narrative.paragraphs].join('\n\n'))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Your plan in words"
        description={narrative.headline}
        actions={<Button size="sm" variant="ghost" icon={copied ? Check : Copy} onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>}
      />
      <Disclosure label="Read the full summary">
        <div className="max-w-3xl space-y-2.5 text-sm leading-relaxed text-fg-secondary">
          {narrative.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
          <p className="text-xs text-fg-muted">Estimates assume steady returns and constant contributions; real markets vary.</p>
        </div>
      </Disclosure>
    </Card>
  )
}
