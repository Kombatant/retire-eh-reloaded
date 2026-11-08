import { useMemo } from 'react'
import {
  Area, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { ProjectionDataPoint } from '@/types/household'
import type { PlannedGiftLite } from '@/lib/calculations'
import { buildContributionGrowth } from '@/lib/contributionGrowth'
import { money, moneyCompact } from '@/lib/formatting'
import { axisProps, chartColors, gridProps, sequentialColors, tooltipProps } from '@/lib/ui/chartTheme'
import { ChartLegend } from '@/components/ui/ChartLegend'

const yAxis = { ...axisProps, width: 60, tickFormatter: (v: number) => moneyCompact(v) }
const ageLabel = (age: unknown) => `Age ${age}`
const moneyFormatter = (value: unknown, name: unknown) => [money(Number(value ?? 0)), String(name ?? '')] as [string, string]

export function ContributionChart({ data, annualContribution, showRealValues, inflationRate }: {
  data: ProjectionDataPoint[]
  annualContribution: number
  showRealValues: boolean
  inflationRate: number
}) {
  const points = useMemo(
    () => buildContributionGrowth({ projectionData: data, annualContribution, showRealValues, inflationRate }),
    [data, annualContribution, showRealValues, inflationRate],
  )
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

const RATES = [4, 4.5, 5, 5.5, 6]

// What constant withdrawal rates do to savings over retirement.
export function DrawdownRatesChart({
  startBalance, expectedReturn, inflationRate, startAge, endAge = 95, showRealValues, plannedGifts, minCurrentAge,
}: {
  startBalance: number
  expectedReturn: number
  inflationRate: number
  startAge: number
  endAge?: number
  showRealValues: boolean
  plannedGifts: PlannedGiftLite[]
  minCurrentAge: number
}) {
  const realReturn = (1 + expectedReturn / 100) / (1 + inflationRate / 100) - 1
  // Simulate in the same dollars the chart shows.
  const annualGrowth = showRealValues ? realReturn : expectedReturn / 100
  const years = endAge - startAge

  const giftAtAge = useMemo(() => {
    const map: Record<number, number> = {}
    for (const g of plannedGifts) {
      const amount = showRealValues ? g.amount : g.amount * Math.pow(1 + inflationRate / 100, Math.max(0, g.age - minCurrentAge))
      map[g.age] = (map[g.age] ?? 0) + amount
    }
    return map
  }, [plannedGifts, showRealValues, inflationRate, minCurrentAge])

  // The constant rate that spends savings to about $0 by endAge.
  const depletionRate = annualGrowth > 0 ? (annualGrowth / (1 - Math.pow(1 + annualGrowth, -years))) * 100 : 0

  const data = useMemo(() => {
    if (startBalance <= 0) return []
    const pathFor = (rate: number) => {
      const pts: number[] = []
      let b = startBalance
      for (let age = startAge; age <= endAge; age++) {
        b -= giftAtAge[age] ?? 0
        pts.push(Math.max(0, b))
        b = b * (1 + annualGrowth) - startBalance * (rate / 100)
      }
      return pts
    }
    const paths = RATES.map(pathFor)
    const deplete = depletionRate > 0 ? pathFor(depletionRate) : null
    return paths[0].map((_, i) => {
      const row: Record<string, number> = { age: startAge + i }
      RATES.forEach((r, idx) => { row[`${r}%`] = paths[idx][i] })
      if (deplete) row.deplete = deplete[i]
      return row
    })
  }, [startBalance, annualGrowth, startAge, endAge, depletionRate, giftAtAge])

  if (data.length === 0) return <p className="text-sm text-fg-muted">Add savings to see how withdrawals draw them down.</p>

  const depleteLabel = `Spend to $0 by ${endAge} (${depletionRate.toFixed(1)}%)`

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
        Each line withdraws a fixed % of the starting balance every year, with a steady {(annualGrowth * 100).toFixed(1)}% return
        ({showRealValues ? 'after inflation' : 'before inflation'}). Lines that stay up mean money left over; the dashed line uses everything by {endAge}.
      </p>
    </>
  )
}
