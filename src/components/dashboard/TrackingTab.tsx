import { useMemo, useState } from 'react'
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts'
import { LineChart as LineChartIcon, Trash2 } from 'lucide-react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { useProjectionContext } from '@/contexts/ProjectionContext'
import { useDarkMode } from '@/hooks/useDarkMode'
import { patchAccount } from '@/lib/plan/edits'
import { isoDate } from '@/lib/plan/defaults'
import { newId } from '@/lib/plan/ids'
import { ACCOUNT_LABELS } from '@/lib/plan/accountGroups'
import { formatCompactMoney, formatMoney } from '@/lib/formatting'
import { NumberInput } from '@/components/ui/NumberInput'
import { InfoTooltip } from './InfoTooltip'

const COLORS = { light: { projected: '#6366f1', actual: '#059669' }, dark: { projected: '#818cf8', actual: '#10b981' } }

function fractionalYear(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return y + ((m - 1) * 30.4 + (d - 1)) / 365
}

// Record actual balances over time and compare them with a saved projection.
export function TrackingTab() {
  const { activePlan, updateActivePlan, snapshots, baselines, addSnapshot, deleteSnapshot, setBaseline, now } = usePlanStore()
  const { simulation } = useProjectionContext()
  const [isDarkMode] = useDarkMode()
  const [date, setDate] = useState(() => isoDate(now))
  const [draft, setDraft] = useState<Record<string, number>>(() => Object.fromEntries(activePlan.accounts.map(a => [a.id, a.balance])))
  const [updatePlan, setUpdatePlan] = useState(true)
  const colors = isDarkMode ? COLORS.dark : COLORS.light
  const muted = isDarkMode ? '#9ca3af' : '#6b7280'

  const planSnapshots = snapshots.filter(s => s.planId === activePlan.id)
  const baseline = baselines.find(b => b.planId === activePlan.id)
  const people = new Map(activePlan.people.map(p => [p.id, p.name]))

  const saveBaseline = () => setBaseline({
    planId: activePlan.id,
    date: isoDate(now),
    // Start-of-year balances, nominal, so they line up with dated snapshots.
    portfolio: simulation.rows.map(r => ({ year: r.year, value: r.balancesStart.reduce((s, b) => s + b, 0) })),
  })

  const record = () => {
    const balances = Object.fromEntries(activePlan.accounts.map(a => [a.id, draft[a.id] ?? a.balance]))
    const total = Object.values(balances).reduce((s, v) => s + v, 0)
    if (!baseline) saveBaseline()
    addSnapshot({ id: newId('snapshot'), planId: activePlan.id, date, balances, total })
    if (updatePlan) {
      updateActivePlan(p => {
        let next = { ...p, asOf: date }
        for (const [id, balance] of Object.entries(balances)) next = patchAccount(next, id, { balance })
        return next
      })
    }
  }

  const chartData = useMemo(() => {
    const projected = (baseline?.portfolio ?? []).slice(0, 25).map(p => ({ x: p.year, projected: p.value }))
    const actual = planSnapshots.map(s => ({ x: fractionalYear(s.date), actual: s.total }))
    return [...projected, ...actual].sort((a, b) => a.x - b.x)
  }, [baseline, planSnapshots])

  const latest = planSnapshots.at(-1)
  const expectedNow = latest && baseline
    ? (() => {
        const x = fractionalYear(latest.date)
        const y0 = Math.floor(x)
        const a = baseline.portfolio.find(p => p.year === y0)
        const b = baseline.portfolio.find(p => p.year === y0 + 1)
        if (!a) return null
        return b ? a.value + (b.value - a.value) * (x - y0) : a.value
      })()
    : null

  return (
    <div className="space-y-6">
      <div className="card p-4 sm:p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-800 dark:text-white">
          <LineChartIcon className="w-5 h-5 text-indigo-500" />
          Record your balances
          <InfoTooltip text="Every few months, enter what your accounts are actually worth. The plan keeps a history so you can see whether you are ahead of or behind your projection." />
        </h2>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <label className="text-xs text-gray-500 dark:text-gray-400">
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
          </label>
          {activePlan.accounts.map(a => (
            <label key={a.id} className="text-xs text-gray-500 dark:text-gray-400">
              {people.get(a.ownerId) ?? 'Joint'} · {a.label || ACCOUNT_LABELS[a.type]}
              <div className="mt-1">
                <NumberInput value={draft[a.id] ?? a.balance} onChange={(v) => setDraft(d => ({ ...d, [a.id]: v }))} step={1000} min={0} ariaLabel={`${a.label || ACCOUNT_LABELS[a.type]} balance`} />
              </div>
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <button onClick={record} disabled={activePlan.accounts.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)} className="h-10 px-4 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
            Save snapshot
          </button>
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
            <input type="checkbox" checked={updatePlan} onChange={(e) => setUpdatePlan(e.target.checked)} className="accent-indigo-500" />
            Also update the plan's balances
          </label>
        </div>
      </div>

      <div className="card p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white">Actual vs. projected</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {baseline ? `Projection saved on ${baseline.date} (nominal dollars).` : 'Save a projection to compare against.'}
            </p>
          </div>
          <button onClick={saveBaseline} className="h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-600 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800">
            {baseline ? 'Rebaseline to current plan' : 'Save projection'}
          </button>
        </div>
        {latest && expectedNow !== null && (
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
            On {latest.date} you had ${formatMoney(latest.total)}, {latest.total >= expectedNow ? 'ahead of' : 'behind'} the projected
            ${formatMoney(expectedNow)} by ${formatMoney(Math.abs(latest.total - expectedNow))}.
          </p>
        )}
        <div className="flex flex-wrap gap-4 text-xs text-gray-600 dark:text-gray-300 my-2" aria-label="Legend">
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-0.5" style={{ background: colors.projected }} />Projected</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: colors.actual }} />Actual</span>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? '#374151' : '#e5e7eb'} strokeOpacity={0.4} vertical={false} />
              <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(v) => String(Math.floor(v))} tick={{ fontSize: 11, fill: muted }} stroke={muted} allowDecimals={false} />
              <YAxis tick={{ fontSize: 11, fill: muted }} stroke={muted} tickFormatter={(v) => formatCompactMoney(v)} width={60} />
              <Tooltip
                contentStyle={{ backgroundColor: isDarkMode ? '#1f2937' : '#fff', border: `1px solid ${isDarkMode ? '#374151' : '#e5e7eb'}`, borderRadius: 8 }}
                labelFormatter={(v) => String(Math.floor(Number(v)))}
                formatter={(value, name) => [`$${formatMoney(Number(value))}`, name === 'actual' ? 'Actual' : 'Projected']}
              />
              <Line dataKey="projected" stroke={colors.projected} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              <Scatter dataKey="actual" fill={colors.actual} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {planSnapshots.length > 0 && (
        <div className="card p-4 sm:p-6 overflow-x-auto">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-2">History</h2>
          <table className="w-full min-w-[420px] text-sm">
            <thead className="text-left text-xs text-gray-500 dark:text-gray-400">
              <tr><th className="py-2">Date</th><th className="py-2 text-right">Total</th><th className="py-2 text-right">Change</th><th /></tr>
            </thead>
            <tbody>
              {planSnapshots.map((s, i) => {
                const prev = planSnapshots[i - 1]
                return (
                  <tr key={s.id} className="border-t border-gray-100 dark:border-gray-700/60 text-gray-700 dark:text-gray-300">
                    <td className="py-2">{s.date}</td>
                    <td className="py-2 text-right tabular-nums">${formatMoney(s.total)}</td>
                    <td className="py-2 text-right tabular-nums">{prev ? `${s.total >= prev.total ? '+' : '−'}$${formatMoney(Math.abs(s.total - prev.total))}` : '—'}</td>
                    <td className="py-2 text-right">
                      <button onClick={() => deleteSnapshot(s.id)} className="p-1 text-gray-400 hover:text-red-500" aria-label={`Delete snapshot from ${s.date}`}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
