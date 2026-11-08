import { useMemo, useState } from 'react'
import { Layer, Rectangle, ResponsiveContainer, Sankey, Tooltip } from 'recharts'
import { Download } from 'lucide-react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { useProjectionContext } from '@/contexts/ProjectionContext'
import { useAssumptions } from '@/contexts/AssumptionsContext'
import { useSubView } from '@/hooks/useSubView'
import { buildSankeyData, type SankeyNode } from '@/lib/insights/sankey'
import { buildYearTable, YEAR_TABLE_HEADERS } from '@/lib/insights/yearTable'
import { downloadCsv, toCsv } from '@/lib/insights/csv'
import { money, moneyCompact } from '@/lib/formatting'
import { chartColors, tooltipProps } from '@/lib/ui/chartTheme'
import { moneyMode } from '@/lib/ui/money'
import { table } from '@/lib/ui/styles'
import { cn } from '@/lib/ui/cn'
import { PageHeader } from '@/components/ui/PageHeader'
import { SubTabs } from '@/components/ui/SubTabs'
import { Card, CardHeader } from '@/components/ui/Card'
import { MoneyModeBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { ChartLegend } from '@/components/ui/ChartLegend'

const TABS = ['flow', 'table'] as const

type Role = 'income' | 'tax' | 'savings' | 'spending' | 'hub'
const ROLE_COLOR: Record<Role, string> = {
  income: chartColors.income,
  tax: chartColors.tax,
  savings: chartColors.savings,
  spending: chartColors.spending,
  hub: 'var(--border-strong)',
}

function roleOf(node: SankeyNode): Role {
  if (node.kind === 'source') return 'income'
  if (node.kind === 'hub') return 'hub'
  if (/tax|clawback|Payroll/i.test(node.name)) return 'tax'
  if (/Savings/.test(node.name)) return 'savings'
  return 'spending'
}

export function CashFlowView() {
  const { activePlan } = usePlanStore()
  const { compiledPlan, simulation } = useProjectionContext()
  const { showRealValues } = useAssumptions()
  const [tab, setTab] = useSubView(TABS, 'flow')
  const [selected, setSelected] = useState<number | null>(null)
  const rows = simulation.rows
  const index = Math.min(rows.length - 1, Math.max(0, selected ?? compiledPlan.drawdownStartOffset))
  const tableRows = useMemo(() => buildYearTable(compiledPlan, simulation, showRealValues), [compiledPlan, simulation, showRealValues])

  const exportCsv = () => {
    downloadCsv(toCsv(YEAR_TABLE_HEADERS, tableRows), `${activePlan.name.replace(/[^\w-]+/g, '-').toLowerCase()}-cash-flow.csv`)
  }

  return (
    <>
      <PageHeader
        title="Cash flow"
        description="Where each year's money comes from and where it goes."
        meta={<MoneyModeBadge mode={moneyMode(showRealValues)} />}
        actions={<Button size="sm" icon={Download} onClick={exportCsv}>Export CSV</Button>}
      />
      <SubTabs
        ariaLabel="Cash flow views"
        value={tab}
        onChange={setTab}
        tabs={[{ value: 'flow', label: 'Money flow' }, { value: 'table', label: 'Year by year' }]}
      >
        {tab === 'flow'
          ? <FlowCard index={index} onSelect={setSelected} />
          : <YearTable rows={tableRows} selected={index} onSelect={(i) => { setSelected(i); setTab('flow') }} />}
      </SubTabs>
    </>
  )
}

interface NodeShapeProps {
  x: number
  y: number
  width: number
  height: number
  payload: SankeyNode & { value: number }
}

interface LinkShapeProps {
  sourceX: number
  targetX: number
  sourceY: number
  targetY: number
  sourceControlX: number
  targetControlX: number
  linkWidth: number
  payload: { source: SankeyNode; target: SankeyNode }
}

function SankeyNodeShape({ x, y, width, height, payload }: NodeShapeProps) {
  const isLeft = payload.kind === 'source'
  return (
    <Layer>
      <Rectangle x={x} y={y} width={width} height={height} fill={ROLE_COLOR[roleOf(payload)]} radius={2} />
      {payload.kind !== 'hub' && (
        <text
          x={isLeft ? x - 8 : x + width + 8}
          y={y + height / 2}
          textAnchor={isLeft ? 'end' : 'start'}
          dominantBaseline="middle"
          fontSize={12}
          fill="var(--fg)"
        >
          {payload.name}
          <tspan fill="var(--fg-muted)"> {moneyCompact(payload.value)}</tspan>
        </text>
      )}
    </Layer>
  )
}

function SankeyLinkShape({ sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, payload }: LinkShapeProps) {
  const role = payload.source.kind === 'source' ? 'income' : roleOf(payload.target)
  return (
    <path
      d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      fill="none"
      stroke={ROLE_COLOR[role]}
      strokeOpacity={0.3}
      strokeWidth={Math.max(1, linkWidth)}
    />
  )
}

function FlowCard({ index, onSelect }: { index: number; onSelect: (i: number) => void }) {
  const { compiledPlan, simulation } = useProjectionContext()
  const { showRealValues } = useAssumptions()
  const rows = simulation.rows
  const row = rows[index]
  const scale = showRealValues ? 1 / row.cpi : 1
  const sankey = useMemo(() => buildSankeyData(row, scale), [row, scale])
  const ages = row.people.map((p, i) => (p.alive ? `${compiledPlan.people[i].name} ${p.age}` : null)).filter(Boolean).join(' · ')

  return (
    <Card>
      <CardHeader
        title={`Where the money goes in ${row.year}`}
        description={`${ages} · ${row.phase === 'drawdown' ? 'retired' : 'working'}`}
        actions={
          <div className="text-right">
            <div className="text-xs text-fg-muted">Cash available</div>
            <div className="text-lg font-semibold text-fg">{money(sankey.total)}</div>
          </div>
        }
      />
      <div>
        <input
          type="range"
          min={0}
          max={rows.length - 1}
          value={index}
          onChange={(e) => onSelect(Number(e.target.value))}
          className="h-5 w-full"
          aria-label="Year"
        />
        <div className="mt-1 flex justify-between text-xs text-fg-muted">
          <button type="button" className="hover:text-fg" onClick={() => onSelect(0)}>{rows[0].year}</button>
          <button type="button" className="hover:text-fg" onClick={() => onSelect(compiledPlan.drawdownStartOffset)}>
            Retirement {rows[compiledPlan.drawdownStartOffset]?.year}
          </button>
          <button type="button" className="hover:text-fg" onClick={() => onSelect(rows.length - 1)}>{rows[rows.length - 1].year}</button>
        </div>
      </div>
      <ChartLegend
        className="mt-4"
        items={[
          { label: 'Income sources', color: ROLE_COLOR.income },
          { label: 'Taxes & payroll', color: ROLE_COLOR.tax },
          { label: 'Savings', color: ROLE_COLOR.savings },
          { label: 'Spending', color: ROLE_COLOR.spending },
        ]}
      />
      <div className="mt-2 overflow-x-auto">
        <div className="h-80 min-w-[640px]">
          {sankey.links.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <Sankey
                data={sankey}
                nodePadding={24}
                nodeWidth={10}
                margin={{ top: 10, right: 190, bottom: 10, left: 170 }}
                node={(p: unknown) => <SankeyNodeShape {...(p as NodeShapeProps)} />}
                link={(p: unknown) => <SankeyLinkShape {...(p as LinkShapeProps)} />}
                iterations={64}
              >
                <Tooltip {...tooltipProps} formatter={(value) => money(Number(value))} />
              </Sankey>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-fg-muted">No cash flows this year.</p>
          )}
        </div>
      </div>
    </Card>
  )
}

// Column presets keep the table readable: 15 columns at once is too many.
const PRESETS = {
  summary: ['Year', 'Ages', 'Phase', 'Withdrawals', 'Tax', 'Spending', 'Portfolio (end)', 'Net worth (end)'],
  income: ['Year', 'Ages', 'Employment', 'Pensions', 'CPP/QPP', 'OAS', 'GIS', 'Other income', 'Withdrawals'],
  all: [...YEAR_TABLE_HEADERS],
} as const
type Preset = keyof typeof PRESETS

function YearTable({ rows, selected, onSelect }: {
  rows: ReturnType<typeof buildYearTable>
  selected: number
  onSelect: (index: number) => void
}) {
  const [preset, setPreset] = useState<Preset>('summary')
  const columns = (PRESETS[preset] as readonly string[]).map(h => YEAR_TABLE_HEADERS.indexOf(h)).filter(i => i >= 0)

  return (
    <Card padding="none">
      <div className="p-4 sm:p-5">
        <CardHeader
          className="mb-0"
          title="Year by year"
          description="Select a year to see its money flow."
          actions={
            <SegmentedControl
              ariaLabel="Columns"
              size="sm"
              value={preset}
              onChange={setPreset}
              options={[{ value: 'summary', label: 'Summary' }, { value: 'income', label: 'Income' }, { value: 'all', label: 'All columns' }]}
            />
          }
        />
      </div>
      <div className="max-h-[32rem] overflow-auto border-t border-border">
        <table className={table.table}>
          <thead className={table.thead}>
            <tr>
              {columns.map(c => (
                <th key={c} className={cn(table.th, c === 0 && 'sticky left-0 bg-surface-muted', c < 3 && 'text-left')}>{YEAR_TABLE_HEADERS[c]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((cells, r) => (
              <tr
                key={String(cells[0])}
                onClick={() => onSelect(r)}
                className={cn(table.tr, 'cursor-pointer', r === selected ? 'bg-accent-subtle' : 'hover:bg-surface-muted')}
              >
                {columns.map(c => {
                  const cell = cells[c]
                  return (
                    <td
                      key={c}
                      className={cn(table.td, c < 3 && 'text-left', c === 0 && cn('sticky left-0 font-medium text-fg', r === selected ? 'bg-accent-subtle' : 'bg-surface'))}
                    >
                      {typeof cell === 'number' && c > 0 ? money(cell) : cell}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
