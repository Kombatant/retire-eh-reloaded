import { compilePlan } from '@/lib/sim/compile'
import { simulate } from '@/lib/sim/simulate'
import { planPath } from '@/lib/sim/paths/deterministic'
import type { PlanV2 } from '@/lib/plan/schema'
import type { Baseline } from '@/lib/plan/storage'

// Whole days since 1970 for a YYYY-MM-DD date, free of any time zone.
function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

function daysInYear(year: number): number {
  return (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86_400_000
}

export function fractionalYear(date: string): number {
  const year = Number(date.slice(0, 4))
  return year + (dayNumber(date) - dayNumber(`${year}-01-01`)) / daysInYear(year)
}

// A projection to compare later balances against: the opening point is the
// balance recorded on that date, then each following January 1 from the plan.
export function baselineFromPlan(plan: PlanV2, startYear: number, date: string, opening: { date: string; value: number }): Baseline {
  const c = compilePlan(plan, { startYear })
  const { rows } = simulate(c, planPath(c))
  const total = (balances: number[]) => balances.reduce((s, b) => s + b, 0)
  return {
    planId: plan.id,
    date,
    portfolio: rows.map(r => ({ year: r.year, value: total(r.balancesStart) })),
    points: [opening, ...rows.slice(1).map(r => ({ date: `${r.year}-01-01`, value: total(r.balancesStart) }))],
  }
}

// What a baseline projected for a date, straight-line between dated points by
// days. Baselines saved before dated points existed held January 1 figures and
// used month-length estimates, so they keep that reading.
export function baselineValueAt(baseline: Baseline, date: string): number | null {
  const { points } = baseline
  if (points === undefined) {
    const x = legacyFractionalYear(date)
    const year = Math.floor(x)
    const a = baseline.portfolio.find(p => p.year === year)
    const b = baseline.portfolio.find(p => p.year === year + 1)
    if (!a) return null
    return b ? a.value + (b.value - a.value) * (x - year) : a.value
  }
  if (points.length === 0) return null
  const day = dayNumber(date)
  if (day <= dayNumber(points[0].date)) return points[0].value
  for (let i = 1; i < points.length; i++) {
    const end = dayNumber(points[i].date)
    if (day > end) continue
    const start = dayNumber(points[i - 1].date)
    return points[i - 1].value + (points[i].value - points[i - 1].value) * (day - start) / (end - start)
  }
  return points[points.length - 1].value
}

function legacyFractionalYear(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return y + ((m - 1) * 30.4 + (d - 1)) / 365
}

// Points for the chart: x is a decimal year.
export function baselineChartPoints(baseline: Baseline, limitYears = 25): { x: number; projected: number }[] {
  if (baseline.points) return baseline.points.slice(0, limitYears).map(p => ({ x: fractionalYear(p.date), projected: p.value }))
  return baseline.portfolio.slice(0, limitYears).map(p => ({ x: p.year, projected: p.value }))
}
