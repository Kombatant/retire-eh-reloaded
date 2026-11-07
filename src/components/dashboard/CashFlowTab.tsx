import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Layer, Rectangle, ResponsiveContainer, Sankey, Tooltip, XAxis, YAxis } from 'recharts'
import { Download, Receipt, Waves } from 'lucide-react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { useProjectionContext } from '@/contexts/ProjectionContext'
import { useAssumptions } from '@/contexts/AssumptionsContext'
import { useDarkMode } from '@/hooks/useDarkMode'
import { buildSankeyData, type SankeyNode } from '@/lib/insights/sankey'
import { buildYearTable, YEAR_TABLE_HEADERS } from '@/lib/insights/yearTable'
import { bracketPosition } from '@/lib/insights/brackets'
import { downloadCsv, toCsv } from '@/lib/insights/csv'
import { formatCompactMoney, formatMoney } from '@/lib/formatting'
import { ModeBadge } from '@/components/ui/ModeBadge'
import { InfoTooltip } from './InfoTooltip'

// Categorical roles validated with the dataviz palette checks.
const ROLE_COLORS = {
  light: { income: '#6366f1', tax: '#f59e0b', savings: '#0ea5e9', spending: '#10b981', hub: '#9ca3af' },
  dark: { income: '#6366f1', tax: '#d97706', savings: '#0284c7', spending: '#059669', hub: '#6b7280' },
}
type Role = keyof typeof ROLE_COLORS.light

function roleOf(node: SankeyNode): Role {
  if (node.kind === 'source') return 'income'
  if (node.kind === 'hub') return 'hub'
  if (/tax|clawback|Payroll/i.test(node.name)) return 'tax'
  if (/Savings/.test(node.name)) return 'savings'
  return 'spending'
}

interface NodeShapeProps {
  x: number
  y: number
  width: number
  height: number
  index: number
  payload: SankeyNode & { value: number }
}

export function CashFlowTab() {
  const { activePlan } = usePlanStore()
  const { compiledPlan, simulation } = useProjectionContext()
  const { showRealValues } = useAssumptions()
  const [isDarkMode] = useDarkMode()
  const rows = simulation.rows
  const [selected, setSelected] = useState<number | null>(null)
  const index = Math.min(rows.length - 1, Math.max(0, selected ?? compiledPlan.drawdownStartOffset))
  const row = rows[index]
  const scale = showRealValues ? 1 / row.cpi : 1
  const colors = isDarkMode ? ROLE_COLORS.dark : ROLE_COLORS.light
  const text = isDarkMode ? '#e5e7eb' : '#374151'
  const muted = isDarkMode ? '#9ca3af' : '#6b7280'

  const sankey = useMemo(() => buildSankeyData(row, scale), [row, scale])
  const table = useMemo(() => buildYearTable(compiledPlan, simulation, showRealValues), [compiledPlan, simulation, showRealValues])
  const taxSeries = useMemo(() => rows.map(r => ({
    year: r.year,
    tax: r.tax / (showRealValues ? r.cpi : 1),
    rate: r.grossIncome > 0 ? (r.tax / r.grossIncome) * 100 : 0,
  })), [rows, showRealValues])
  const lifetimeTax = taxSeries.reduce((s, r) => s + r.tax, 0)

  const ages = row.people
    .map((p, i) => (p.alive ? `${compiledPlan.people[i].name} ${p.age}` : null))
    .filter(Boolean)
    .join(' · ')

  const NodeShape = (props: NodeShapeProps) => {
    const { x, y, width, height, payload } = props
    const role = roleOf(payload)
    const isLeft = payload.kind === 'source'
    const isHub = payload.kind === 'hub'
    const labelX = isLeft ? x - 6 : x + width + 6
    const anchor = isLeft ? 'end' : 'start'
    return (
      <Layer>
        <Rectangle x={x} y={y} width={width} height={height} fill={colors[role]} radius={2} />
        {!isHub && (
          <text x={labelX} y={y + height / 2} textAnchor={anchor} dominantBaseline="middle" fontSize={12} fill={text}>
            {payload.name}
            <tspan fill={muted}> ${formatCompactMoney(payload.value)}</tspan>
          </text>
        )}
      </Layer>
    )
  }

  const LinkShape = (props: { sourceX: number; targetX: number; sourceY: number; targetY: number; sourceControlX: number; targetControlX: number; linkWidth: number; payload: { source: SankeyNode; target: SankeyNode } }) => {
    const { sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, payload } = props
    const role = payload.source.kind === 'source' ? 'income' : roleOf(payload.target)
    return (
      <path
        d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
        fill="none"
        stroke={colors[role]}
        strokeOpacity={0.35}
        strokeWidth={Math.max(1, linkWidth)}
      />
    )
  }

  const exportCsv = () => {
    downloadCsv(toCsv(YEAR_TABLE_HEADERS, table), `${activePlan.name.replace(/[^\w-]+/g, '-').toLowerCase()}-cash-flow.csv`)
  }

  return (
    <div className="space-y-6">
      <div className="card p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-800 dark:text-white">
              <Waves className="w-5 h-5 text-indigo-500" />
              Where the money goes in {row.year}
              <ModeBadge showRealValues={showRealValues} />
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">{ages} · {row.phase === 'drawdown' ? 'retired' : 'working'}</p>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-500 dark:text-gray-400">Cash available</div>
            <div className="text-xl font-semibold tabular-nums text-gray-900 dark:text-white">${formatMoney(sankey.total)}</div>
          </div>
        </div>
        <label className="mt-3 block">
          <span className="sr-only">Year</span>
          <input
            type="range"
            min={0}
            max={rows.length - 1}
            value={index}
            onChange={(e) => setSelected(Number(e.target.value))}
            className="w-full accent-indigo-500"
            aria-label="Year"
          />
          <div className="flex justify-between text-[11px] text-gray-500 dark:text-gray-400">
            <span>{rows[0].year}</span>
            <span>Retirement {rows[compiledPlan.drawdownStartOffset]?.year}</span>
            <span>{rows[rows.length - 1].year}</span>
          </div>
        </label>
        <div className="flex flex-wrap gap-4 text-xs text-gray-600 dark:text-gray-300 mt-3" aria-label="Legend">
          {(['income', 'tax', 'savings', 'spending'] as const).map(role => (
            <span key={role} className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ background: colors[role] }} />
              {role === 'income' ? 'Income sources' : role === 'tax' ? 'Taxes & payroll' : role === 'savings' ? 'Savings' : 'Spending'}
            </span>
          ))}
        </div>
        <div className="mt-2 overflow-x-auto">
          <div className="h-80 min-w-[640px]">
            {sankey.links.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <Sankey
                  data={sankey}
                  nodePadding={24}
                  nodeWidth={10}
                  margin={{ top: 10, right: 190, bottom: 10, left: 170 }}
                  node={(p: unknown) => <NodeShape {...(p as NodeShapeProps)} />}
                  link={(p: unknown) => <LinkShape {...(p as Parameters<typeof LinkShape>[0])} />}
                  iterations={64}
                >
                  <Tooltip formatter={(value) => `$${formatMoney(Number(value))}`} />
                </Sankey>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-gray-500">No cash flows this year.</p>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-4 sm:p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-800 dark:text-white">
            <Receipt className="w-5 h-5 text-indigo-500" />
            Income tax by year
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            Lifetime: ${formatMoney(lifetimeTax)}{simulation.estate ? ` plus $${formatMoney(simulation.estate.finalReturnTax * (showRealValues ? 1 / simulation.estate.cpi : 1))} on the final return` : ''}.
          </p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={taxSeries} margin={{ top: 10, right: 8, left: 0, bottom: 0 }} barCategoryGap={1}>
                <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? '#374151' : '#e5e7eb'} strokeOpacity={0.4} vertical={false} />
                <XAxis dataKey="year" tick={{ fontSize: 11, fill: muted }} stroke={muted} interval={9} />
                <YAxis tick={{ fontSize: 11, fill: muted }} stroke={muted} tickFormatter={(v) => formatCompactMoney(v)} width={56} />
                <Tooltip
                  contentStyle={{ backgroundColor: isDarkMode ? '#1f2937' : '#fff', border: `1px solid ${isDarkMode ? '#374151' : '#e5e7eb'}`, borderRadius: 8 }}
                  formatter={(value, _n, item) => [`$${formatMoney(Number(value))} (${item.payload.rate.toFixed(1)}% of income)`, 'Tax']}
                />
                <Bar dataKey="tax" fill={colors.tax} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white">
            Room in the current bracket ({row.year})
            <InfoTooltip text="Combined federal and provincial bracket rate on the next dollar of taxable income, and how much more income fits before the rate changes. Useful for planning RRSP withdrawals or a meltdown. Statutory rates only: credits phasing out and the OAS clawback can raise the effective rate." />
          </h2>
          <div className="mt-3 space-y-3">
            {row.people.map((p, i) => {
              if (!p.alive) return null
              const person = compiledPlan.people[i]
              const position = bracketPosition(p.taxableIncome / row.cpi, person.province)
              return (
                <div key={person.id} className="rounded-lg bg-gray-50 dark:bg-gray-800/60 p-3">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium text-gray-900 dark:text-gray-100">{person.name}</span>
                    <span className="tabular-nums text-gray-700 dark:text-gray-300">{position.marginalRatePct.toFixed(1)}% bracket</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Taxable income ${formatMoney(p.taxableIncome * scale)}
                    {position.room !== null && <> · ${formatMoney(position.room * (showRealValues ? 1 : row.cpi))} until the rate changes</>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="card p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white">Year by year</h2>
          <button onClick={exportCsv} className="flex items-center gap-2 h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-600 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800">
            <Download className="w-4 h-4" /> Export CSV
          </button>
        </div>
        <div className="max-h-[28rem] overflow-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full min-w-[1100px] text-xs">
            <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
              <tr>{YEAR_TABLE_HEADERS.map(h => <th key={h} className="px-2 py-2 text-right first:text-left whitespace-nowrap font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {table.map((cells, r) => (
                <tr
                  key={String(cells[0])}
                  onClick={() => setSelected(r)}
                  className={`cursor-pointer border-t border-gray-100 dark:border-gray-700/60 text-gray-700 dark:text-gray-300 ${r === index ? 'bg-indigo-50 dark:bg-indigo-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800/40'}`}
                >
                  {cells.map((cell, c) => (
                    <td key={c} className={`px-2 py-1.5 whitespace-nowrap ${c < 3 ? 'text-left' : 'text-right tabular-nums'}`}>
                      {typeof cell === 'number' && c > 0 ? `$${formatMoney(cell)}` : cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
