import { useMemo, useState } from 'react'
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from 'lucide-react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { useProjectionContext } from '@/contexts/ProjectionContext'
import { useRiskAnalysis } from '@/hooks/useRiskAnalysis'
import { useSubView } from '@/hooks/useSubView'
import { patchSimulation } from '@/lib/plan/edits'
import { HISTORICAL_RANGE, HISTORICAL_SOURCE } from '@/lib/sim/paths/historical'
import { successDescription, successIsMeaningful } from '@/lib/sim/risk'
import { householdBaseAge } from '@/lib/sim'
import { money, moneyCompact } from '@/lib/formatting'
import { axisProps, barTooltipProps, chartColors, gridProps, sequentialColors, tooltipProps } from '@/lib/ui/chartTheme'
import { table } from '@/lib/ui/styles'
import { cn } from '@/lib/ui/cn'
import { PageHeader } from '@/components/ui/PageHeader'
import { SubTabs } from '@/components/ui/SubTabs'
import { Card, CardHeader } from '@/components/ui/Card'
import { Stat, type StatTone } from '@/components/ui/Stat'
import { Callout } from '@/components/ui/Callout'
import { MoneyModeBadge } from '@/components/ui/Badge'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Field } from '@/components/ui/Field'
import { PercentInput, Select } from '@/components/ui/inputs'
import { Checkbox } from '@/components/ui/Checkbox'
import { Button } from '@/components/ui/Button'
import { ChartLegend } from '@/components/ui/ChartLegend'
import { Advanced } from '@/components/ui/Advanced'

const TABS = ['monte-carlo', 'historical', 'stress'] as const

function verdict(rate: number | undefined): { tone: StatTone; label: string } {
  if (rate === undefined) return { tone: 'default', label: 'Calculating…' }
  const pct = rate * 100
  if (pct >= 85) return { tone: 'success', label: 'Strong' }
  if (pct >= 70) return { tone: 'warning', label: 'Some risk' }
  return { tone: 'danger', label: 'At risk' }
}

function Verdict({ rate }: { rate: number | undefined }) {
  const v = verdict(rate)
  const Icon = v.tone === 'success' ? CheckCircle2 : v.tone === 'warning' ? AlertTriangle : v.tone === 'danger' ? XCircle : RefreshCw
  return <span className="inline-flex items-center gap-1"><Icon className="h-3.5 w-3.5" aria-hidden />{v.label}</span>
}

export function RiskView() {
  const risk = useRiskAnalysis()
  const { compiledPlan, simulation } = useProjectionContext()
  const testable = successIsMeaningful(compiledPlan, simulation)
  const [tab, setTab] = useSubView(TABS, 'monte-carlo')
  const mc = risk.monteCarlo
  const backtest = risk.backtest
  const pct = (r: number | undefined) => (r === undefined ? '—' : `${Math.round(r * 100)}%`)

  return (
    <>
      <PageHeader
        title="Risk"
        description="How your plan holds up when markets and inflation don't follow the average."
        meta={<MoneyModeBadge mode="fixedReal" />}
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat
          label="Chance of success"
          value={testable ? pct(mc?.successRate) : 'n/a'}
          tone={testable ? verdict(mc?.successRate).tone : undefined}
          info={successDescription(compiledPlan)}
          sub={testable ? <><Verdict rate={mc?.successRate} />{mc && <> · {mc.successes} of {mc.runs} runs</>}{risk.stale && <> · updating</>}</> : 'No withdrawals to test'}
        />
        <Stat
          label="Historical success"
          value={testable ? pct(backtest?.successRate) : 'n/a'}
          tone={testable ? verdict(backtest?.successRate).tone : undefined}
          info={`Your whole plan, from today, replayed through actual Canadian returns and inflation starting in each year from ${HISTORICAL_RANGE}. Plans longer than the data wrap around to the start of it.`}
          sub={<><Verdict rate={backtest?.successRate} />{backtest && <> · {backtest.windows.filter(w => w.success).length} of {backtest.windows.length} start years</>}</>}
        />
        <Stat
          label="Estate, median"
          value={mc ? moneyCompact(mc.medianEstate) : '—'}
          info="After-tax estate at the end of the plan across simulated markets."
          sub={mc ? `9 in 10 runs leave at least ${moneyCompact(mc.p10Estate)}` : 'Calculating…'}
        />
      </div>

      <SubTabs
        ariaLabel="Risk views"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'monte-carlo', label: 'Simulated markets' },
          { value: 'historical', label: 'Historical' },
          { value: 'stress', label: 'Stress tests' },
        ]}
      >
        {risk.error && <Callout tone="danger" title="Risk analysis failed" className="mb-4">{risk.error}</Callout>}
        {tab === 'monte-carlo' && <MonteCarloCard />}
        {tab === 'historical' && <HistoricalCard />}
        {tab === 'stress' && <StressCard />}
      </SubTabs>

      <p className="mt-6 text-xs text-fg-muted">
        Simulations draw correlated yearly returns for Canadian stocks, bonds and cash and, optionally, persistent random inflation.
        Historical data: {HISTORICAL_SOURCE} Past returns do not predict future returns.
      </p>
    </>
  )
}

function MonteCarloCard() {
  const { activePlan, updateActivePlan } = usePlanStore()
  const { compiledPlan } = useProjectionContext()
  const risk = useRiskAnalysis()
  const sim = activePlan.assumptions.simulation
  const baseAge = householdBaseAge(compiledPlan)
  const update = (patch: Parameters<typeof patchSimulation>[1]) => updateActivePlan(p => patchSimulation(p, patch))

  const data = useMemo(() => (risk.monteCarlo?.bands ?? []).map((b, t) => ({
    age: baseAge + t,
    outer: [b.p10, b.p90] as [number, number],
    inner: [b.p25, b.p75] as [number, number],
    median: b.p50,
  })), [risk.monteCarlo, baseAge])

  return (
    <Card>
      <CardHeader
        title="Range of outcomes"
        description={`Savings in today's dollars, by age${activePlan.people.length > 1 ? ' of the youngest person' : ''}.`}
        actions={risk.running ? <span className="text-xs text-fg-muted" role="status">Simulating… {Math.round((risk.progress ?? 0) * 100)}%</span> : undefined}
      />
      <ChartLegend
        className="mb-3"
        items={[
          { label: 'Middle 80% of outcomes', color: sequentialColors[0] },
          { label: 'Middle 50%', color: sequentialColors[2] },
          { label: 'Median', color: sequentialColors[4], shape: 'line' },
        ]}
      />
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="age" {...axisProps} minTickGap={24} />
            <YAxis {...axisProps} width={60} tickFormatter={(v: number) => moneyCompact(v)} />
            <Tooltip
              {...tooltipProps}
              labelFormatter={(age) => `Age ${age}`}
              formatter={(value, name) => (Array.isArray(value)
                ? [`${money(value[0])} – ${money(value[1])}`, String(name)]
                : [money(Number(value)), String(name)])}
            />
            <Area type="monotone" dataKey="outer" name="10th–90th percentile" stroke="none" fill={sequentialColors[0]} fillOpacity={0.35} isAnimationActive={false} />
            <Area type="monotone" dataKey="inner" name="25th–75th percentile" stroke="none" fill={sequentialColors[2]} fillOpacity={0.4} isAnimationActive={false} />
            <Line type="monotone" dataKey="median" name="Median" stroke={sequentialColors[4]} strokeWidth={2} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <Advanced>
        <div className="mt-5 grid grid-cols-1 items-end gap-4 border-t border-border pt-5 sm:grid-cols-4">
          <Field label="Simulations">
            <Select size="sm" value={sim.runs} onChange={(e) => update({ runs: Number(e.target.value) })}>
              {[250, 500, 1000, 2000].map(n => <option key={n} value={n}>{n}</option>)}
            </Select>
          </Field>
          <Field label="Portfolio volatility" info="Yearly standard deviation of returns for accounts without an investment mix. About 10–12% suits a balanced portfolio.">
            <PercentInput size="sm" value={sim.portfolioVolPct} min={0} max={40} onChange={(v) => update({ portfolioVolPct: v })} />
          </Field>
          <Checkbox className="pb-1.5" checked={sim.stochasticInflation} onChange={(on) => update({ stochasticInflation: on })} label="Random inflation" />
          <Button size="sm" icon={RefreshCw} onClick={() => update({ seed: (sim.seed * 7919 + 13) % 1000003 })}>New random draw</Button>
        </div>
      </Advanced>
    </Card>
  )
}

function HistoricalCard() {
  const risk = useRiskAnalysis()
  const backtest = risk.backtest
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const worst = useMemo(() => (backtest?.windows ?? []).slice().sort((a, b) => a.minReal - b.minReal).slice(0, 3), [backtest])

  return (
    <Card>
      <CardHeader
        title="If your plan had started in a past year"
        description={`Savings left at the end, in today's dollars. Each start year runs your whole plan from today, including the years before you retire. The data covers ${HISTORICAL_RANGE}; longer plans wrap around to its start.`}
        actions={<SegmentedControl ariaLabel="Display" size="sm" value={view} onChange={setView} options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} />}
      />
      {!backtest ? (
        <p className="text-sm text-fg-muted">Running backtest…</p>
      ) : view === 'chart' ? (
        <>
          <ul className="mb-3 flex gap-5 text-xs text-fg-secondary">
            <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden />Every year funded</li>
            <li className="flex items-center gap-1.5"><XCircle className="h-3.5 w-3.5 text-danger" aria-hidden />Ran short</li>
          </ul>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={backtest.windows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="startYear" {...axisProps} minTickGap={20} />
                <YAxis {...axisProps} width={60} tickFormatter={(v: number) => moneyCompact(v)} />
                <Tooltip
                  {...barTooltipProps}
                  labelFormatter={(year) => `Start in ${year}`}
                  formatter={(value, _n, item) => [`${money(Number(value))}${item.payload.success ? '' : ` · ran short in ${item.payload.failureYear}`}`, 'Savings at the end']}
                />
                <Bar dataKey="endingReal" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                  {backtest.windows.map(w => <Cell key={w.startYear} fill={w.success ? chartColors.good : chartColors.bad} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      ) : (
        <div className={cn(table.wrap, 'max-h-80')}>
          <table className={table.table}>
            <thead className={table.thead}>
              <tr><th className={table.th}>Start year</th><th className={cn(table.th, 'text-left')}>Result</th><th className={table.th}>Lowest in retirement</th><th className={table.th}>At the end</th></tr>
            </thead>
            <tbody>
              {backtest.windows.map(w => (
                <tr key={w.startYear} className={table.tr}>
                  <td className={cn(table.td, 'font-medium text-fg')}>{w.startYear}</td>
                  <td className={cn(table.td, 'text-left', !w.success && 'text-danger')}>{w.success ? 'Funded' : `Short in ${w.failureYear}`}</td>
                  <td className={table.td}>{money(w.minReal)}</td>
                  <td className={table.td}>{money(w.endingReal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {worst.length > 0 && (
        <p className="mt-4 text-xs text-fg-secondary">
          Hardest start years for this plan: {worst.map(w => `${w.startYear} (low of ${moneyCompact(w.minReal)})`).join(', ')}.
        </p>
      )}
    </Card>
  )
}

function StressCard() {
  const risk = useRiskAnalysis()
  return (
    <Card padding="none">
      <div className="p-4 sm:p-5">
        <CardHeader className="mb-0" title="Market shocks early in retirement" description="Historical crashes replayed in your first years of retirement, with average markets otherwise." />
      </div>
      <div className="overflow-x-auto border-t border-border">
        <table className={cn(table.table, 'min-w-[560px]')}>
          <thead className={table.thead}>
            <tr>
              <th className={table.th}>Scenario</th>
              <th className={cn(table.th, 'text-left')}>Result</th>
              <th className={table.th}>Lowest</th>
              <th className={table.th}>At the end</th>
              <th className={table.th}>vs. average</th>
            </tr>
          </thead>
          <tbody>
            {(risk.crashes ?? []).map(s => (
              <tr key={s.id} className={table.tr}>
                <td className={cn(table.td, 'whitespace-normal')}>
                  <div className="font-medium text-fg">{s.label}</div>
                  <div className="text-xs text-fg-muted">{s.description}</div>
                </td>
                <td className={cn(table.td, 'text-left')}>
                  {s.success
                    ? <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-4 w-4" aria-hidden />Funded</span>
                    : <span className="inline-flex items-center gap-1 text-danger"><XCircle className="h-4 w-4" aria-hidden />Ran short</span>}
                </td>
                <td className={table.td}>{money(s.minReal)}</td>
                <td className={table.td}>{money(s.endingReal)}</td>
                <td className={table.td}>{s.baselineEndingReal > 0 ? `${Math.round(((s.endingReal - s.baselineEndingReal) / s.baselineEndingReal) * 100)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
