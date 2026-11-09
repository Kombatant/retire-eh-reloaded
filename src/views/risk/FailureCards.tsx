import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowRight, Lightbulb, XCircle } from 'lucide-react'
import { useRoute } from '@/contexts/RouteContext'
import { useProposals } from '@/hooks/useProposals'
import { failureCause, failureNotes, fixesForRisk, pct1 } from '@/lib/insights/failureExplanation'
import { TARGET_SUCCESS } from '@/lib/insights/proposals'
import type { AgeBucket, FailureSummary, MedianComparison } from '@/lib/sim/failures'
import { moneyCompact } from '@/lib/formatting'
import { axisProps, barTooltipProps, chartColors, gridProps, tooltipProps } from '@/lib/ui/chartTheme'
import { table } from '@/lib/ui/styles'
import { cn } from '@/lib/ui/cn'
import { Card, CardHeader } from '@/components/ui/Card'
import { Stat } from '@/components/ui/Stat'
import { Callout } from '@/components/ui/Callout'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { pct, TARGET_PCT } from '@/views/proposals/format'
import { TestingProgress } from '@/views/proposals/TestingProgress'

const years = (n: number) => `${n} year${n === 1 ? '' : 's'}`

function ComparisonRow({ label, values, format }: { label: string; values: MedianComparison | null; format: (v: number) => string }) {
  if (!values) return null
  return (
    <tr className={table.tr}>
      <td className={cn(table.td, 'whitespace-normal text-left font-medium text-fg')}>{label}</td>
      <td className={table.td}>{format(values.failed)}</td>
      <td className={table.td}>{format(values.funded)}</td>
    </tr>
  )
}

function TooltipRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-6">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="font-medium text-fg-secondary">{value}</dd>
    </div>
  )
}

// Recharts fills in `active` and `payload` when it renders this.
export function AgeBucketTooltip({ active, payload, unit, failed }: {
  active?: boolean
  payload?: readonly { payload?: AgeBucket }[]
  unit: string
  failed: number
}) {
  const bucket = payload?.[0]?.payload
  if (!active || !bucket) return null
  const { detail } = bucket
  const noun = bucket.runs === 1 ? unit.replace(/s$/, '') : unit
  return (
    <div style={tooltipProps.contentStyle}>
      <div style={tooltipProps.labelStyle}>First short at age {bucket.label}</div>
      {!detail ? (
        <p className="text-fg-muted">No failing {unit} first fell short at these ages.</p>
      ) : (
        <>
          <p className="mb-1.5 text-fg-secondary">
            {bucket.runs} failing {noun} · {Math.round((bucket.runs / failed) * 100)}% of all failures
          </p>
          <dl className="space-y-0.5">
            <TooltipRow label="Time spent short" value={years(detail.shortYears)} />
            <TooltipRow label="Gap each year" value={moneyCompact(detail.annualShortfall)} />
            <TooltipRow label="Gap over the plan" value={moneyCompact(detail.totalShortfall)} />
            {detail.fundedShare !== null && <TooltipRow label="Budget still paid" value={`${Math.round(detail.fundedShare * 100)}%`} />}
            <TooltipRow label="Savings already gone" value={`${bucket.runs - detail.moneyLeft} of ${bucket.runs}`} />
            {detail.savingsAtRetirement !== null && <TooltipRow label="Savings at retirement" value={moneyCompact(detail.savingsAtRetirement)} />}
            {detail.earlyRealReturn !== null && <TooltipRow label="Return in early retirement" value={`${pct1(detail.earlyRealReturn)} after inflation`} />}
          </dl>
          <p className="mt-1.5 text-[11px] text-fg-muted">Middle values, in today's dollars.</p>
        </>
      )}
    </div>
  )
}

export function FailureAnalysisCard({ failures, unit, subject, averageMarketsFail, youngestLabel }: {
  failures: FailureSummary
  // Plural: "runs" or "start years".
  unit: string
  subject: string
  averageMarketsFail: boolean
  youngestLabel: boolean
}) {
  const { firstShortAge: age, comparison } = failures
  const cause = failureCause(failures, averageMarketsFail)
  const notes = failureNotes(failures, subject, unit)
  const ageRange = age.earliest === age.latest ? `All at age ${age.earliest}` : `Between ${age.earliest} and ${age.latest}`

  return (
    <Card>
      <CardHeader
        title="How your plan fails"
        description={`What happened in the ${failures.failed} of ${failures.total} ${unit} that fell short. Dollars are today's; figures are the middle value across those ${unit}.`}
      />
      <Callout tone={cause.severe ? 'danger' : 'warning'} title={cause.title} className="mb-4">
        {cause.body}
      </Callout>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat bare label="First falls short" value={`Age ${age.median}`} sub={`${ageRange}${youngestLabel ? ' · youngest person' : ''}`} />
        <Stat bare label="Time spent short" value={years(failures.shortYears)} sub={`Years your ${subject} isn't fully met`} />
        <Stat bare label="Size of the gap" value={`${moneyCompact(failures.annualShortfall)} a year`} sub={`${moneyCompact(failures.totalShortfall)} over the whole plan`} />
      </div>

      {failures.byAge.length > 1 && (
        <div className="mt-5 border-t border-border pt-5">
          <h3 className="mb-2 text-sm font-semibold text-fg">Age at the first shortfall</h3>
          {/* Just above the sticky table header below, which the tooltip can overlap. */}
          <div className="relative z-[11] h-56" role="img" aria-label={`Failing ${unit} by age at first shortfall: ${failures.byAge.map(b => `${b.label}: ${b.runs}`).join(', ')}`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={failures.byAge} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" {...axisProps} />
                <YAxis {...axisProps} width={40} allowDecimals={false} />
                <Tooltip cursor={barTooltipProps.cursor} allowEscapeViewBox={{ y: true }} content={<AgeBucketTooltip unit={unit} failed={failures.failed} />} />
                <Bar dataKey="runs" fill={chartColors.bad} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {comparison && (comparison.savingsAtRetirement || comparison.earlyRealReturn || comparison.earlyInflation) && (
        <div className="mt-5 border-t border-border pt-5">
          <h3 className="mb-2 text-sm font-semibold text-fg">What was different about the {unit} that fell short</h3>
          <div className="overflow-x-auto">
            <table className={cn(table.table, 'min-w-[420px]')}>
              <thead className={table.thead}>
                <tr>
                  <th className={cn(table.th, 'text-left')}>Middle value</th>
                  <th className={table.th}>Fell short</th>
                  <th className={table.th}>Fully funded</th>
                </tr>
              </thead>
              <tbody>
                <ComparisonRow label="Savings at retirement" values={comparison.savingsAtRetirement} format={moneyCompact} />
                <ComparisonRow label={`Return after inflation, first ${years(comparison.earlyYears)} of retirement`} values={comparison.earlyRealReturn} format={pct1} />
                <ComparisonRow label={`Inflation, first ${years(comparison.earlyYears)} of retirement`} values={comparison.earlyInflation} format={pct1} />
              </tbody>
            </table>
          </div>
        </div>
      )}

      {notes.length > 0 && (
        <ul className="mt-4 list-disc space-y-1.5 pl-5 text-[13px] text-fg-secondary">
          {notes.map(note => <li key={note}>{note}</li>)}
        </ul>
      )}
    </Card>
  )
}

// Mounted only when the chance of success is below the target, because it
// starts the whole proposals job. The job's cache is shared with the Proposals
// page, so opening that page afterwards costs nothing.
export function WhatNeedsToHappenCard({ successRate }: { successRate: number }) {
  const { navigate } = useRoute()
  const { base, proposals = [], running, tested = 0, progress = 0, error } = useProposals()
  const fixes = fixesForRisk(proposals, base?.successRate ?? successRate)
  const reached = fixes.some(p => (p.score.successRate ?? 0) >= TARGET_SUCCESS)

  return (
    <Card>
      <CardHeader
        title="What needs to happen"
        icon={Lightbulb}
        description={`Your chance of success is ${pct(successRate)}. These changes were tested by re-running your whole plan on the same simulated markets, aiming for ${TARGET_PCT}%.`}
        actions={<Button size="sm" icon={ArrowRight} onClick={() => navigate({ view: 'proposals' })}>See all proposals</Button>}
      />
      {error && <Callout tone="danger" title="Something went wrong">{error}</Callout>}
      {running && <div className="mb-4"><TestingProgress label="Testing changes to your plan…" detail={`${tested} tested`} progress={progress} /></div>}

      {!running && !error && fixes.length === 0 && (
        <p className="flex items-start gap-2 text-sm text-fg-secondary">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
          No single change we tested raised your chance of success. The gap is larger than one lever can close, so look at spending, savings and retirement age together.
        </p>
      )}
      {!running && fixes.length > 0 && !reached && (
        <p className="mb-3 text-sm text-fg-secondary">No single change reaches {TARGET_PCT}%. These get closest; you may need more than one.</p>
      )}

      {fixes.length > 0 && (
        <ul className="divide-y divide-border">
          {fixes.map(p => {
            const rate = p.score.successRate ?? 0
            const gain = Math.round((rate - (base?.successRate ?? successRate)) * 100)
            return (
              <li key={p.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-fg">{p.title}</h3>
                  <p className="mt-0.5 text-[13px] text-fg-muted">{p.detail}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-sm">
                  <span className="font-medium text-fg">{pct(rate)}</span>
                  <span className="text-xs text-fg-muted">{gain} pts higher</span>
                  {rate >= TARGET_SUCCESS
                    ? <Badge tone="success">Reaches {TARGET_PCT}%</Badge>
                    : <Badge tone="warning">Still short of {TARGET_PCT}%</Badge>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
