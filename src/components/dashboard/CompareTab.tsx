import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CheckCircle2, Columns3, XCircle } from 'lucide-react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { useDarkMode } from '@/hooks/useDarkMode'
import { comparePlans } from '@/lib/insights/compare'
import { formatCompactMoney, formatMoney } from '@/lib/formatting'

// Fixed categorical order, validated for light and dark surfaces.
const SERIES = {
  light: ['#6366f1', '#10b981', '#0ea5e9'],
  dark: ['#6366f1', '#059669', '#0284c7'],
}
const MAX_PLANS = 3

export function CompareTab() {
  const { plans, activePlan, nowYear, duplicatePlan } = usePlanStore()
  const [isDarkMode] = useDarkMode()
  const [chosen, setChosen] = useState<string[]>(() => plans.slice(0, MAX_PLANS).map(p => p.id))
  const selected = plans.filter(p => chosen.includes(p.id)).slice(0, MAX_PLANS)
  const results = useMemo(() => comparePlans(selected, nowYear), [selected, nowYear])
  const colors = isDarkMode ? SERIES.dark : SERIES.light
  const muted = isDarkMode ? '#9ca3af' : '#6b7280'

  // Merge each plan's net-worth series on year.
  const chartData = useMemo(() => {
    const years = new Map<number, Record<string, number>>()
    results.forEach(r => r.netWorth.forEach(({ year, value }) => {
      const point = years.get(year) ?? { year }
      point[r.id] = value
      years.set(year, point)
    }))
    return [...years.values()].sort((a, b) => a.year - b.year)
  }, [results])

  const toggle = (id: string) => setChosen(prev => (
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id].slice(-MAX_PLANS)
  ))

  if (plans.length < 2) {
    return (
      <div className="card p-6 text-center space-y-3">
        <Columns3 className="w-8 h-8 mx-auto text-indigo-500" />
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Compare scenarios side by side: retire earlier, save more, downsize, change strategy.
        </p>
        <button onClick={() => duplicatePlan(activePlan.id)} className="h-10 px-4 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">
          Duplicate “{activePlan.name}” to start a comparison
        </button>
      </div>
    )
  }

  const metrics: { label: string; render: (r: typeof results[number]) => React.ReactNode }[] = [
    { label: 'Household retires', render: r => r.retirementYear },
    { label: 'Portfolio at retirement', render: r => `$${formatMoney(r.portfolioAtRetirement)}` },
    { label: 'Average after-tax income in retirement', render: r => `$${formatMoney(r.averageRetirementIncome)}/yr` },
    { label: 'Lifetime income tax', render: r => `$${formatMoney(r.lifetimeTax)}` },
    { label: 'Money lasts', render: r => (r.depletionYear ? `Until ${r.depletionYear}` : 'Whole plan') },
    { label: 'After-tax estate', render: r => `$${formatMoney(r.afterTaxEstate)}` },
    {
      label: 'Average markets',
      render: r => (
        <span className="inline-flex items-center gap-1">
          {r.onTrack ? <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-hidden /> : <XCircle className="w-4 h-4 text-rose-600" aria-hidden />}
          {r.onTrack ? 'Fully funded' : 'Runs short'}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="card p-4">
        <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Plans to compare (up to {MAX_PLANS})</div>
        <div className="flex flex-wrap gap-2">
          {plans.map(p => (
            <label key={p.id} className={`flex items-center gap-2 px-3 min-h-[36px] rounded-lg border text-sm cursor-pointer ${chosen.includes(p.id) ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30' : 'border-gray-300 dark:border-gray-600'}`}>
              <input type="checkbox" checked={chosen.includes(p.id)} onChange={() => toggle(p.id)} className="accent-indigo-500" />
              <span className="text-gray-800 dark:text-gray-200">{p.name}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="card p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-white">Net worth (today's dollars)</h2>
        <div className="flex flex-wrap gap-4 text-xs text-gray-600 dark:text-gray-300 my-2" aria-label="Legend">
          {results.map((r, i) => (
            <span key={r.id} className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-0.5" style={{ background: colors[i] }} />
              {r.name}
            </span>
          ))}
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? '#374151' : '#e5e7eb'} strokeOpacity={0.4} vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 11, fill: muted }} stroke={muted} />
              <YAxis tick={{ fontSize: 11, fill: muted }} stroke={muted} tickFormatter={(v) => formatCompactMoney(v)} width={60} />
              <Tooltip
                contentStyle={{ backgroundColor: isDarkMode ? '#1f2937' : '#fff', border: `1px solid ${isDarkMode ? '#374151' : '#e5e7eb'}`, borderRadius: 8 }}
                formatter={(value, name) => [`$${formatMoney(Number(value))}`, results.find(r => r.id === name)?.name ?? name]}
              />
              {results.map((r, i) => (
                <Line key={r.id} type="monotone" dataKey={r.id} stroke={colors[i]} strokeWidth={2} dot={false} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card p-4 sm:p-6 overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
              <th className="py-2 pr-3 font-medium">In today's dollars</th>
              {results.map((r, i) => (
                <th key={r.id} className="py-2 px-3 font-semibold text-gray-900 dark:text-white">
                  <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: colors[i] }} />{r.name}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map(m => (
              <tr key={m.label} className="border-t border-gray-100 dark:border-gray-700/60 text-gray-700 dark:text-gray-300">
                <td className="py-2 pr-3 text-gray-500 dark:text-gray-400">{m.label}</td>
                {results.map(r => <td key={r.id} className="py-2 px-3 tabular-nums">{m.render(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-[11px] text-gray-500 dark:text-gray-400">
          Based on average returns. Switch to a plan and open the Risk tab for its Monte Carlo and historical results.
        </p>
      </div>
    </div>
  )
}
