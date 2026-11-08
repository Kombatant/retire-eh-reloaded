import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CheckCircle2, Columns3, Copy, XCircle } from 'lucide-react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { comparePlans, type PlanComparison } from '@/lib/insights/compare'
import { money, moneyCompact } from '@/lib/formatting'
import { axisProps, gridProps, seriesOrder, tooltipProps } from '@/lib/ui/chartTheme'
import { table } from '@/lib/ui/styles'
import { cn } from '@/lib/ui/cn'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardHeader } from '@/components/ui/Card'
import { MoneyModeBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ChartLegend } from '@/components/ui/ChartLegend'

const MAX_PLANS = 3

interface Metric {
  label: string
  render: (r: PlanComparison) => React.ReactNode
  // Used to highlight the best plan on this row; omitted when "best" is unclear.
  score?: (r: PlanComparison) => number
}

const METRICS: Metric[] = [
  { label: 'Household retires', render: r => r.retirementYear },
  { label: 'Savings at retirement', render: r => money(r.portfolioAtRetirement), score: r => r.portfolioAtRetirement },
  { label: 'Average income after tax', render: r => `${money(r.averageRetirementIncome)}/yr`, score: r => r.averageRetirementIncome },
  { label: 'Lifetime income tax', render: r => money(r.lifetimeTax), score: r => -r.lifetimeTax },
  { label: 'Money lasts', render: r => (r.depletionYear ? `Until ${r.depletionYear}` : 'Whole plan'), score: r => r.depletionYear ?? Infinity },
  { label: 'Estate after tax', render: r => money(r.afterTaxEstate), score: r => r.afterTaxEstate },
  {
    label: 'With average markets',
    render: r => r.onTrack
      ? <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-4 w-4" aria-hidden />Fully funded</span>
      : <span className="inline-flex items-center gap-1 text-danger"><XCircle className="h-4 w-4" aria-hidden />Runs short</span>,
  },
]

export function CompareView() {
  const { plans, activePlan, nowYear, duplicatePlan } = usePlanStore()
  const [chosen, setChosen] = useState<string[]>(() => plans.slice(0, MAX_PLANS).map(p => p.id))
  const selected = plans.filter(p => chosen.includes(p.id)).slice(0, MAX_PLANS)
  const results = useMemo(() => comparePlans(selected, nowYear), [selected, nowYear])
  // Colour follows the plan, not its position among the selected ones.
  const colorOf = (id: string) => seriesOrder[Math.max(0, plans.findIndex(p => p.id === id)) % seriesOrder.length]

  const chartData = useMemo(() => {
    const years = new Map<number, Record<string, number>>()
    results.forEach(r => r.netWorth.forEach(({ year, value }) => {
      const point = years.get(year) ?? { year }
      point[r.id] = value
      years.set(year, point)
    }))
    return [...years.values()].sort((a, b) => a.year - b.year)
  }, [results])

  const toggle = (id: string) => setChosen(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id].slice(-MAX_PLANS)))

  const header = (
    <PageHeader
      title="Compare"
      description="Two or three saved plans side by side: retire earlier, save more, downsize or change strategy."
      meta={<MoneyModeBadge mode="fixedReal" />}
    />
  )

  if (plans.length < 2) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            icon={Columns3}
            title="You have one plan"
            description="Make a copy, change one thing, and compare the two here."
            action={<Button variant="primary" icon={Copy} onClick={() => duplicatePlan(activePlan.id)}>Duplicate “{activePlan.name}”</Button>}
          />
        </Card>
      </>
    )
  }

  return (
    <>
      {header}
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Plans to compare (up to ${MAX_PLANS})`}>
          <span className="mr-1 text-[13px] text-fg-muted">Comparing</span>
          {plans.map(p => {
            const on = chosen.includes(p.id)
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(p.id)}
                className={cn(
                  'inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[13px] font-medium',
                  on ? 'border-border-strong bg-surface text-fg shadow-[0_1px_2px_rgba(16,24,40,0.06)]' : 'border-dashed border-border-strong text-fg-muted hover:text-fg',
                )}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: on ? colorOf(p.id) : 'var(--border-strong)' }} aria-hidden />
                {p.name}
              </button>
            )
          })}
        </div>

        <Card>
          <CardHeader title="Net worth over time" description="Savings plus home equity, less debts." />
          <ChartLegend className="mb-3" items={results.map(r => ({ label: r.name, color: colorOf(r.id), shape: 'line' as const }))} />
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="year" {...axisProps} minTickGap={24} />
                <YAxis {...axisProps} width={60} tickFormatter={(v: number) => moneyCompact(v)} />
                <Tooltip
                  {...tooltipProps}
                  formatter={(value, name) => [money(Number(value)), results.find(r => r.id === name)?.name ?? String(name)]}
                />
                {results.map(r => (
                  <Line key={r.id} type="monotone" dataKey={r.id} stroke={colorOf(r.id)} strokeWidth={2} dot={false} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card padding="none">
          <div className="overflow-x-auto">
            <table className={cn(table.table, 'min-w-[520px]')}>
              <thead className={table.thead}>
                <tr>
                  <th className={cn(table.th, 'text-left')}>Average markets</th>
                  {results.map(r => (
                    <th key={r.id} className={cn(table.th, 'text-fg')}>
                      <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: colorOf(r.id) }} aria-hidden />{r.name}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METRICS.map(m => {
                  const scores = m.score ? results.map(m.score) : []
                  const best = scores.length > 1 && new Set(scores).size > 1 ? Math.max(...scores) : null
                  return (
                    <tr key={m.label} className={table.tr}>
                      <td className={cn(table.td, 'text-fg-muted')}>{m.label}</td>
                      {results.map((r, i) => (
                        <td key={r.id} className={cn(table.td, best !== null && scores[i] === best && 'font-semibold text-fg')}>{m.render(r)}</td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="border-t border-border px-4 py-3 text-xs text-fg-muted sm:px-5">
            The best value on each row is in bold. Open a plan's Risk page for its simulated and historical results.
          </p>
        </Card>
      </div>
    </>
  )
}
