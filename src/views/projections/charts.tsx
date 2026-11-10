import { useMemo } from 'react'
import {
  Area, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { CompiledPlan, YearRow } from '@/lib/sim/types'
import { buildContributionGrowth } from '@/lib/contributionGrowth'
import { buildSpendingLevels, type SpendingLevel } from '@/lib/insights/spendingLevels'
import { buildWithdrawalRateSeries, WITHDRAWAL_RATES } from '@/lib/insights/withdrawalRates'
import { money, moneyCompact } from '@/lib/formatting'
import { axisProps, chartColors, gridProps, sequentialColors, tooltipProps } from '@/lib/ui/chartTheme'
import { ChartLegend } from '@/components/ui/ChartLegend'

const yAxis = { ...axisProps, width: 60, tickFormatter: (v: number) => moneyCompact(v) }
const ageLabel = (age: unknown) => `Age ${age}`
const moneyFormatter = (value: unknown, name: unknown) => [money(Number(value ?? 0)), String(name ?? '')] as [string, string]

export function ContributionChart({ rows, firstAge, showRealValues }: {
  rows: YearRow[]
  firstAge: number
  showRealValues: boolean
}) {
  const points = useMemo(() => buildContributionGrowth(rows, firstAge, showRealValues), [rows, firstAge, showRealValues])
  if (points.length === 0) return null

  return (
    <>
      <ChartLegend
        className="mb-3"
        items={[
          { label: 'Your contributions', color: chartColors.contributions },
          { label: 'Investment growth', color: chartColors.growth },
        ]}
      />
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="age" {...axisProps} minTickGap={24} />
            <YAxis {...yAxis} />
            <Tooltip {...tooltipProps} labelFormatter={ageLabel} formatter={moneyFormatter} />
            <Area dataKey="contributions" name="Contributions" stackId="a" stroke={chartColors.contributions} strokeWidth={1.5} fill={chartColors.contributions} fillOpacity={0.18} isAnimationActive={false} />
            <Area dataKey="growth" name="Growth" stackId="a" stroke={chartColors.growth} strokeWidth={1.5} fill={chartColors.growth} fillOpacity={0.18} isAnimationActive={false} />
            <Line dataKey="total" name="Total" stroke="none" dot={false} activeDot={false} legendType="none" isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  )
}

// What spending more or less each year does to savings over retirement.
export function SpendingLevelsChart({ compiledPlan, expectedReturn, showRealValues }: {
  compiledPlan: CompiledPlan
  expectedReturn: number
  showRealValues: boolean
}) {
  const result = useMemo(
    () => buildSpendingLevels(compiledPlan, expectedReturn, showRealValues),
    [compiledPlan, expectedReturn, showRealValues],
  )
  if (!result) return <p className="text-sm text-fg-muted">Add retirement spending to compare yearly amounts.</p>

  const { ages, levels, highestSustainable: highest } = result
  const lastAge = ages[ages.length - 1]
  const labelFor = (level: SpendingLevel) => {
    const notes = [level.isPlan && 'your plan', level.runsOutAtAge !== null && `runs out at ${level.runsOutAtAge}`].filter(Boolean)
    return `${moneyCompact(level.spending)} a year${notes.length > 0 ? ` (${notes.join(', ')})` : ''}`
  }
  const highestLabel = highest ? `Most that lasts to ${lastAge} (${moneyCompact(highest.spending)} a year)` : ''
  const data = ages.map((age, i) => {
    const row: Record<string, number> = { age }
    levels.forEach((level, l) => { row[`level${l}`] = level.balances[i] })
    if (highest) row.highest = highest.balances[i]
    return row
  })
  const isBudget = compiledPlan.expenseMode === 'detailed'

  return (
    <>
      <ChartLegend
        className="mb-3"
        items={[
          ...levels.map((level, l) => ({ label: labelFor(level), color: sequentialColors[l], shape: 'line' as const })),
          ...(highest ? [{ label: highestLabel, color: chartColors.total, shape: 'dashed' as const }] : []),
        ]}
      />
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="age" {...axisProps} minTickGap={24} />
            <YAxis {...yAxis} />
            <Tooltip {...tooltipProps} labelFormatter={ageLabel} formatter={moneyFormatter} />
            <ReferenceLine y={0} stroke={chartColors.grid} />
            {levels.map((level, l) => (
              <Line key={level.spending} dataKey={`level${l}`} name={labelFor(level)} stroke={sequentialColors[l]} strokeWidth={level.isPlan ? 3 : 2} dot={false} isAnimationActive={false} />
            ))}
            {highest && (
              <Line dataKey="highest" name={highestLabel} stroke={chartColors.total} strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-3 text-xs text-fg-muted">
        Each line spends that amount every year of retirement ({isBudget ? 'after tax' : 'as income before tax'}, in today's dollars, rising with inflation),
        with CPP, OAS and pensions covering their share and savings the rest, at a steady {expectedReturn}% return before inflation.
        {compiledPlan.strategy !== 'expenses' && ' Your plan sets withdrawals by a rule (Plan › Withdrawals); these lines withdraw what each amount needs instead, so they can differ from the other charts.'}
      </p>
    </>
  )
}

const RATES = WITHDRAWAL_RATES

// What constant withdrawal rates do to savings over retirement, each a full
// simulation with tax, benefits and account limits.
export function DrawdownRatesChart({ compiledPlan, expectedReturn, showRealValues }: {
  compiledPlan: CompiledPlan
  expectedReturn: number
  showRealValues: boolean
}) {
  const { data, depletionRate, endAge } = useMemo(
    () => buildWithdrawalRateSeries(compiledPlan, expectedReturn, showRealValues),
    [compiledPlan, expectedReturn, showRealValues],
  )

  if (data.length === 0) return <p className="text-sm text-fg-muted">Add savings to see how withdrawals draw them down.</p>

  const depleteLabel = depletionRate > 0 ? `Spend to $0 by ${endAge} (${depletionRate.toFixed(1)}%)` : ''

  return (
    <>
      <ChartLegend
        className="mb-3"
        items={[
          ...RATES.map((r, i) => ({ label: `${r}%`, color: sequentialColors[i], shape: 'line' as const })),
          ...(depletionRate > 0 ? [{ label: depleteLabel, color: chartColors.total, shape: 'dashed' as const }] : []),
        ]}
      />
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="age" {...axisProps} minTickGap={24} />
            <YAxis {...yAxis} />
            <Tooltip {...tooltipProps} labelFormatter={ageLabel} formatter={moneyFormatter} />
            <ReferenceLine y={0} stroke={chartColors.grid} />
            {RATES.map((r, i) => (
              <Line key={r} dataKey={`${r}%`} name={`${r}% withdrawal`} stroke={sequentialColors[i]} strokeWidth={2} dot={false} isAnimationActive={false} />
            ))}
            {depletionRate > 0 && (
              <Line dataKey="deplete" name={depleteLabel} stroke={chartColors.total} strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-3 text-xs text-fg-muted">
        Each line is a full simulation that withdraws a fixed % of savings in the first retirement year, then keeps pace with inflation, at a steady {expectedReturn}% return before inflation.
        Tax, benefits, required minimums and one-time costs all count. Lines that stay up mean money left over; the dashed line uses everything by {endAge}.
      </p>
    </>
  )
}
