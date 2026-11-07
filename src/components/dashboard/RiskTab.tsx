import { useMemo, useState } from 'react'
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, CheckCircle2, Dice5, History, ShieldAlert, XCircle } from 'lucide-react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { useProjectionContext } from '@/contexts/ProjectionContext'
import { useDarkMode } from '@/hooks/useDarkMode'
import { useRiskAnalysis } from '@/hooks/useRiskAnalysis'
import { patchSimulation } from '@/lib/plan/edits'
import { formatCompactMoney, formatMoney } from '@/lib/formatting'
import { HISTORICAL_RANGE, HISTORICAL_SOURCE } from '@/lib/sim/paths/historical'
import { householdBaseAge } from '@/lib/sim'
import { InfoTooltip } from './InfoTooltip'

// Validated with the dataviz palette checks (light and dark surfaces).
const FAN = {
  light: { outer: '#818cf8', inner: '#4f46e5', median: '#312e81' },
  dark: { outer: '#4338ca', inner: '#818cf8', median: '#c7d2fe' },
}
const STATUS = {
  light: { good: '#059669', bad: '#e11d48' },
  dark: { good: '#10b981', bad: '#fb7185' },
}

function chartTheme(dark: boolean) {
  return {
    grid: dark ? '#374151' : '#e5e7eb',
    axis: dark ? '#9ca3af' : '#6b7280',
    tooltipBg: dark ? '#1f2937' : '#ffffff',
    tooltipBorder: dark ? '#374151' : '#e5e7eb',
  }
}

function SuccessTile({ label, rate, detail, help }: { label: string; rate: number | undefined; detail: string; help: string }) {
  const pct = rate === undefined ? null : Math.round(rate * 100)
  const tone = pct === null ? 'text-gray-400' : pct >= 85 ? 'text-emerald-700 dark:text-emerald-400' : pct >= 70 ? 'text-amber-700 dark:text-amber-400' : 'text-rose-700 dark:text-rose-400'
  const Icon = pct === null ? Dice5 : pct >= 85 ? CheckCircle2 : pct >= 70 ? AlertTriangle : XCircle
  const verdict = pct === null ? 'Calculating…' : pct >= 85 ? 'Strong' : pct >= 70 ? 'Some risk' : 'At risk'
  return (
    <div className="card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
        <InfoTooltip text={help} />
      </div>
      <div className={`mt-1 flex items-baseline gap-2 ${tone}`}>
        <span className="text-3xl font-bold tabular-nums">{pct === null ? '—' : `${pct}%`}</span>
        <span className="flex items-center gap-1 text-sm font-medium"><Icon className="w-4 h-4" aria-hidden />{verdict}</span>
      </div>
      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{detail}</div>
    </div>
  )
}

export function RiskTab() {
  const { activePlan, updateActivePlan } = usePlanStore()
  const { compiledPlan } = useProjectionContext()
  const [isDarkMode] = useDarkMode()
  const risk = useRiskAnalysis()
  const [showTable, setShowTable] = useState(false)
  const sim = activePlan.assumptions.simulation
  const fan = isDarkMode ? FAN.dark : FAN.light
  const status = isDarkMode ? STATUS.dark : STATUS.light
  const theme = chartTheme(isDarkMode)
  const baseAge = householdBaseAge(compiledPlan)

  const fanData = useMemo(() => (risk.monteCarlo?.bands ?? []).map((b, t) => ({
    age: baseAge + t,
    outer: [b.p10, b.p90] as [number, number],
    inner: [b.p25, b.p75] as [number, number],
    median: b.p50,
    p10: b.p10,
    p90: b.p90,
  })), [risk.monteCarlo, baseAge])

  const backtest = risk.backtest
  const worst = useMemo(() => (backtest?.windows ?? []).slice().sort((a, b) => a.minReal - b.minReal).slice(0, 5), [backtest])
  const update = (patch: Parameters<typeof patchSimulation>[1]) => updateActivePlan(p => patchSimulation(p, patch))
  const tooltipStyle = { backgroundColor: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, borderRadius: 8 }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SuccessTile
          label="Chance of success"
          rate={risk.monteCarlo?.successRate}
          detail={risk.monteCarlo ? `${risk.monteCarlo.successes} of ${risk.monteCarlo.runs} simulated markets fund every year of the plan${risk.running ? ' (still running)' : ''}` : 'Running simulations…'}
          help="Share of Monte Carlo runs in which your spending (or planned withdrawals) is fully funded every year until the end of the plan. Randomized returns and inflation; the whole plan is re-run each time, including taxes and benefits."
        />
        <SuccessTile
          label="Historical success"
          rate={backtest?.successRate}
          detail={backtest ? `Works in ${backtest.windows.filter(w => w.success).length} of ${backtest.windows.length} Canadian start years (${HISTORICAL_RANGE})` : 'Running backtest…'}
          help="The plan replayed through actual Canadian market returns and inflation starting in each historical year. Sequences longer than the data wrap around to the start."
        />
        <div className="card p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Estate (today's $)
            <InfoTooltip text="After-tax estate at the end of the plan across the Monte Carlo runs: the median, and the amount 9 in 10 runs exceed." />
          </div>
          <div className="mt-1 text-3xl font-bold tabular-nums text-gray-900 dark:text-white">
            {risk.monteCarlo ? `$${formatCompactMoney(risk.monteCarlo.medianEstate)}` : '—'}
          </div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            median · 90% of runs leave at least {risk.monteCarlo ? `$${formatCompactMoney(risk.monteCarlo.p10Estate)}` : '—'}
          </div>
        </div>
      </div>

      <div className="card p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-800 dark:text-white">
              <Dice5 className="w-5 h-5 text-indigo-500" />
              Range of outcomes
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">Investment portfolio in today's dollars, by age{activePlan.people.length > 1 ? ' of the youngest person' : ''}.</p>
          </div>
          {risk.running && (
            <div className="text-xs text-gray-500 dark:text-gray-400" role="status">
              Simulating… {Math.round((risk.progress ?? 0) * 100)}%
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-gray-600 dark:text-gray-300 mb-2" aria-label="Legend">
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: fan.outer }} />10th–90th percentile</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: fan.inner }} />25th–75th percentile</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-0.5" style={{ background: fan.median }} />Median</span>
        </div>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={fanData} margin={{ top: 10, right: 16, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} strokeOpacity={0.4} vertical={false} />
              <XAxis dataKey="age" stroke={theme.axis} tick={{ fontSize: 12, fill: theme.axis }} ticks={fanData.filter(d => d.age % 5 === 0).map(d => d.age)} label={{ value: 'Age', position: 'insideBottom', offset: -10, fill: theme.axis, fontSize: 12 }} />
              <YAxis stroke={theme.axis} tick={{ fontSize: 12, fill: theme.axis }} tickFormatter={(v) => formatCompactMoney(v)} width={60} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(age) => `Age ${age}`}
                formatter={(value, name) => {
                  if (Array.isArray(value)) return [`$${formatMoney(value[0])} – $${formatMoney(value[1])}`, name]
                  return [`$${formatMoney(Number(value))}`, name]
                }}
              />
              <Area type="monotone" dataKey="outer" name="10th–90th" stroke="none" fill={fan.outer} fillOpacity={0.35} isAnimationActive={false} />
              <Area type="monotone" dataKey="inner" name="25th–75th" stroke="none" fill={fan.inner} fillOpacity={0.45} isAnimationActive={false} />
              <Line type="monotone" dataKey="median" name="Median" stroke={fan.median} strokeWidth={2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 border-t border-gray-200 dark:border-gray-700 pt-3">
          <label className="text-xs text-gray-500 dark:text-gray-400">
            Simulations
            <select value={sim.runs} onChange={(e) => update({ runs: Number(e.target.value) })} className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-white">
              {[250, 500, 1000, 2000].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-500 dark:text-gray-400">
            Portfolio volatility %
            <InfoTooltip text="Annual standard deviation of returns for accounts without an asset mix. About 10–12% suits a balanced portfolio; accounts with a mix use the asset-class volatilities." />
            <input type="number" min={0} max={40} step={1} value={sim.portfolioVolPct} onChange={(e) => update({ portfolioVolPct: Math.max(0, parseFloat(e.target.value) || 0) })} className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 pt-5">
            <input type="checkbox" checked={sim.stochasticInflation} onChange={(e) => update({ stochasticInflation: e.target.checked })} className="accent-indigo-500" />
            Random inflation
          </label>
          <div className="pt-4">
            <button onClick={() => update({ seed: (sim.seed * 7919 + 13) % 1000003 })} className="h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-600 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800">
              New random draw
            </button>
          </div>
        </div>
      </div>

      <div className="card p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-800 dark:text-white">
              <History className="w-5 h-5 text-indigo-500" />
              Historical backtest
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">Portfolio left at the end of the plan (today's dollars) if your plan had started in each year.</p>
          </div>
          <button onClick={() => setShowTable(!showTable)} className="text-xs text-indigo-600 dark:text-indigo-400 font-medium min-h-[28px]">
            {showTable ? 'Show chart' : 'Show table'}
          </button>
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-gray-600 dark:text-gray-300 mb-2" aria-label="Legend">
          <span className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" style={{ color: status.good }} aria-hidden />Every year funded</span>
          <span className="flex items-center gap-1.5"><XCircle className="w-3.5 h-3.5" style={{ color: status.bad }} aria-hidden />Ran short</span>
        </div>
        {backtest && !showTable && (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={backtest.windows} margin={{ top: 10, right: 16, left: 0, bottom: 10 }} barCategoryGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} strokeOpacity={0.4} vertical={false} />
                <XAxis dataKey="startYear" stroke={theme.axis} tick={{ fontSize: 11, fill: theme.axis }} interval={4} />
                <YAxis stroke={theme.axis} tick={{ fontSize: 12, fill: theme.axis }} tickFormatter={(v) => formatCompactMoney(v)} width={60} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  cursor={{ fill: theme.grid, fillOpacity: 0.3 }}
                  labelFormatter={(year) => `Start in ${year}`}
                  formatter={(value, _name, item) => [
                    `$${formatMoney(Number(value))}${item.payload.success ? '' : ` · ran short in ${item.payload.failureYear}`}`,
                    'Ending portfolio',
                  ]}
                />
                <Bar dataKey="endingReal" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {backtest.windows.map(w => <Cell key={w.startYear} fill={w.success ? status.good : status.bad} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {backtest && showTable && (
          <div className="max-h-72 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                <tr><th className="px-3 py-2 text-left">Start year</th><th className="px-3 py-2 text-left">Result</th><th className="px-3 py-2 text-right">Lowest in retirement</th><th className="px-3 py-2 text-right">Ending</th></tr>
              </thead>
              <tbody>
                {backtest.windows.map(w => (
                  <tr key={w.startYear} className="border-t border-gray-100 dark:border-gray-700/60 text-gray-700 dark:text-gray-300">
                    <td className="px-3 py-1.5">{w.startYear}</td>
                    <td className="px-3 py-1.5">{w.success ? 'Funded' : `Short in ${w.failureYear}`}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">${formatMoney(w.minReal)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">${formatMoney(w.endingReal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {worst.length > 0 && (
          <p className="mt-3 text-xs text-gray-600 dark:text-gray-300">
            Hardest start years for this plan: {worst.map(w => `${w.startYear} (lowest $${formatCompactMoney(w.minReal)})`).join(', ')}.
          </p>
        )}
      </div>

      <div className="card p-4 sm:p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-800 dark:text-white mb-1">
          <ShieldAlert className="w-5 h-5 text-indigo-500" />
          Stress tests
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Historical shocks replayed in the first years of retirement, with average markets otherwise.</p>
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/60 text-left text-xs text-gray-500 dark:text-gray-400">
              <tr><th className="px-3 py-2">Scenario</th><th className="px-3 py-2">Result</th><th className="px-3 py-2 text-right">Lowest</th><th className="px-3 py-2 text-right">Ending</th><th className="px-3 py-2 text-right">vs. average markets</th></tr>
            </thead>
            <tbody>
              {(risk.crashes ?? []).map(s => (
                <tr key={s.id} className="border-t border-gray-100 dark:border-gray-700/60 text-gray-700 dark:text-gray-300">
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-900 dark:text-gray-100">{s.label}</div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400">{s.description}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1 text-xs font-medium">
                      {s.success
                        ? <><CheckCircle2 className="w-4 h-4" style={{ color: status.good }} aria-hidden />Funded</>
                        : <><XCircle className="w-4 h-4" style={{ color: status.bad }} aria-hidden />Ran short</>}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">${formatMoney(s.minReal)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">${formatMoney(s.endingReal)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.baselineEndingReal > 0 ? `${Math.round(((s.endingReal - s.baselineEndingReal) / s.baselineEndingReal) * 100)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-gray-500 dark:text-gray-400">
        Monte Carlo draws correlated yearly returns for Canadian equities, bonds and cash (lognormal) and, optionally, persistent
        random inflation. Historical data: {HISTORICAL_SOURCE} Equity returns include dividends; bond returns are estimated from
        Government of Canada long-bond yields. Past returns do not predict future returns.
      </p>
    </div>
  )
}
