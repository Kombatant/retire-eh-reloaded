import { Area, AreaChart, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  ACCOUNT_CATEGORY_LABELS, categoriesInUse, type AccountBreakdownYear, type AccountCategory,
} from '@/lib/insights/accountBreakdown'
import { money, moneyCompact } from '@/lib/formatting'
import { axisProps, barTooltipProps, chartColors, gridProps, tooltipProps } from '@/lib/ui/chartTheme'
import { table } from '@/lib/ui/styles'
import { cn } from '@/lib/ui/cn'
import { ChartLegend } from '@/components/ui/ChartLegend'

const categoryColors: Record<AccountCategory, string> = {
  rrsp: chartColors.registered,
  stock: chartColors.stock,
  tfsa: chartColors.tfsa,
  nonreg: chartColors.nonRegistered,
  lockedIn: chartColors.lockedIn,
  cash: chartColors.cash,
  fhsa: chartColors.fhsa,
}

const yAxis = { ...axisProps, width: 60, tickFormatter: (v: number) => moneyCompact(v) }

// Pensions and government benefits are one neutral segment so the account
// colours stay the focus; the tooltip and table break them down.
const INCOME_LABEL = 'Pensions & benefits'
const INCOME_COLOR = chartColors.other
const SPENDABLE_LABEL = 'Left to spend after tax'

const guaranteed = (r: AccountBreakdownYear) => r.pension + r.cpp + r.oas + r.gis
const otherIncome = (r: AccountBreakdownYear) => r.otherIncome + r.employment

// Shared tooltip body: one figure per line, with optional colour key and
// subtotal rules. Lines worth less than a dollar are left out.
interface TipLine {
  label: string
  value: number
  color?: string
  kind?: 'subtotal' | 'less' | 'warn'
}

type TipProps = { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }
const rowOf = (p: TipProps) => (p.active ? (p.payload?.[0]?.payload as { src?: AccountBreakdownYear } | undefined)?.src : undefined)

function TipBox({ row, lines }: { row: AccountBreakdownYear; lines: TipLine[] }) {
  return (
    <div style={tooltipProps.contentStyle}>
      <p style={tooltipProps.labelStyle}>Age {row.age} · {row.year}</p>
      <table className="w-full">
        <tbody>
          {lines.filter(l => l.kind === 'subtotal' || Math.abs(l.value) >= 1).map(l => (
            <tr key={l.label} className={cn(l.kind === 'subtotal' && 'border-t border-border font-medium text-fg', l.kind === 'warn' && 'text-danger')}>
              <td className="py-0.5 pr-4">
                <span className="flex items-center gap-1.5">
                  {l.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: l.color }} aria-hidden />}
                  {l.label}
                </span>
              </td>
              <td className="py-0.5 text-right tabular-nums">{l.kind === 'less' ? `−${money(l.value)}` : money(l.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Start-of-year savings stacked by account category; the top edge is the total.
export function AccountBalancesChart({ rows }: { rows: AccountBreakdownYear[] }) {
  const cats = categoriesInUse(rows, 'balances')
  const data = rows.map(r => ({ age: r.age, src: r, ...r.balances }))
  if (cats.length === 0) return <p className="text-sm text-fg-muted">Add savings accounts to see them here.</p>

  return (
    <>
      <ChartLegend className="mb-3" items={cats.map(c => ({ label: ACCOUNT_CATEGORY_LABELS[c], color: categoryColors[c] }))} />
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="age" {...axisProps} minTickGap={24} />
            <YAxis {...yAxis} />
            <Tooltip
              {...tooltipProps}
              content={(p: TipProps) => {
                const row = rowOf(p)
                if (!row) return null
                // Listed top to bottom in the same order as the stack.
                const lines: TipLine[] = [...cats].reverse().map(c => ({ label: ACCOUNT_CATEGORY_LABELS[c], value: row.balances[c], color: categoryColors[c] }))
                return <TipBox row={row} lines={[...lines, { label: 'Total', value: row.balanceTotal, kind: 'subtotal' }]} />
              }}
            />
            {cats.map(c => (
              <Area
                key={c}
                type="monotone"
                dataKey={c}
                name={ACCOUNT_CATEGORY_LABELS[c]}
                stackId="balances"
                stroke={categoryColors[c]}
                strokeWidth={1.5}
                fill={categoryColors[c]}
                fillOpacity={0.18}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </>
  )
}

function sourceLines(r: AccountBreakdownYear, cats: AccountCategory[]): TipLine[] {
  const incomeIn = guaranteed(r) + otherIncome(r)
  return [
    ...[...cats].reverse().map(c => ({ label: `From ${ACCOUNT_CATEGORY_LABELS[c]}`, value: r.withdrawals[c], color: categoryColors[c] })),
    { label: 'CPP/QPP', value: r.cpp, color: INCOME_COLOR },
    { label: 'OAS', value: r.oas, color: INCOME_COLOR },
    { label: 'GIS', value: r.gis, color: INCOME_COLOR },
    { label: 'Pensions', value: r.pension, color: INCOME_COLOR },
    { label: 'Other income', value: otherIncome(r), color: INCOME_COLOR },
    { label: 'Total coming in', value: r.withdrawalTotal + incomeIn, kind: 'subtotal' },
    { label: 'Tax & payroll', value: r.tax, kind: 'less' },
    { label: 'Reinvested', value: r.reinvested, kind: 'less' },
    { label: SPENDABLE_LABEL, value: r.afterTaxIncome, kind: 'subtotal' },
    { label: 'One-time costs paid from savings', value: r.oneTimeExpenses },
    { label: 'Not covered', value: r.shortfall, kind: 'warn' },
  ]
}

// Each retirement year's cash: withdrawals stacked by account on top of
// pensions and benefits, with what is left to spend after tax as a line.
export function IncomeSourcesChart({ rows }: { rows: AccountBreakdownYear[] }) {
  const cats = categoriesInUse(rows, 'withdrawals')
  const data = rows.map(r => ({
    age: r.age,
    src: r,
    income: guaranteed(r) + otherIncome(r),
    spendable: r.afterTaxIncome,
    ...Object.fromEntries(cats.map(c => [`wd_${c}`, r.withdrawals[c]])),
  }))

  return (
    <>
      <ChartLegend
        className="mb-3"
        items={[
          { label: INCOME_LABEL, color: INCOME_COLOR },
          ...cats.map(c => ({ label: ACCOUNT_CATEGORY_LABELS[c], color: categoryColors[c] })),
          { label: SPENDABLE_LABEL, color: chartColors.total, shape: 'line' as const },
        ]}
      />
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={1}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="age" {...axisProps} minTickGap={24} />
            <YAxis {...yAxis} />
            <Tooltip
              {...barTooltipProps}
              content={(p: TipProps) => {
                const row = rowOf(p)
                return row ? <TipBox row={row} lines={sourceLines(row, cats)} /> : null
              }}
            />
            <Bar dataKey="income" name={INCOME_LABEL} stackId="in" fill={INCOME_COLOR} fillOpacity={0.5} isAnimationActive={false} />
            {cats.map(c => (
              <Bar key={c} dataKey={`wd_${c}`} name={ACCOUNT_CATEGORY_LABELS[c]} stackId="in" fill={categoryColors[c]} isAnimationActive={false} />
            ))}
            <Line dataKey="spendable" name={SPENDABLE_LABEL} stroke={chartColors.total} strokeWidth={2} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  )
}

// The same figures as a year-by-year table, with totals over the period.
export function IncomeSourcesTable({ rows }: { rows: AccountBreakdownYear[] }) {
  const cats = categoriesInUse(rows, 'withdrawals')
  const columns: { label: string; value: (r: AccountBreakdownYear) => number; less?: boolean }[] = [
    ...cats.map(c => ({ label: ACCOUNT_CATEGORY_LABELS[c], value: (r: AccountBreakdownYear) => r.withdrawals[c] })),
    { label: 'CPP/QPP', value: r => r.cpp },
    { label: 'OAS & GIS', value: r => r.oas + r.gis },
    { label: 'Pensions', value: r => r.pension },
    { label: 'Other income', value: otherIncome },
    { label: 'Tax & payroll', value: r => r.tax, less: true },
    { label: 'Reinvested', value: r => r.reinvested, less: true },
    { label: SPENDABLE_LABEL, value: r => r.afterTaxIncome },
  ]
  // Hide income columns that are empty for the whole period.
  const shown = columns.filter((col, i) => i < cats.length || col.label === SPENDABLE_LABEL || rows.some(r => col.value(r) >= 1))
  const cell = (v: number, less?: boolean) => (Math.abs(v) < 1 ? '—' : less ? `−${money(v)}` : money(v))

  return (
    <div className="max-h-[28rem] overflow-auto rounded-lg border border-border">
      <table className={table.table}>
        <thead className={table.thead}>
          <tr>
            <th className={cn(table.th, 'sticky left-0 bg-surface-muted')}>Age</th>
            <th className={table.th}>Year</th>
            {shown.map(col => <th key={col.label} className={table.th}>{col.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.year} className={table.tr}>
              <td className={cn(table.td, 'sticky left-0 bg-surface font-medium text-fg')}>{r.age}</td>
              <td className={table.td}>{r.year}</td>
              {shown.map(col => <td key={col.label} className={table.td}>{cell(col.value(r), col.less)}</td>)}
            </tr>
          ))}
        </tbody>
        <tfoot className={table.tfoot}>
          <tr>
            <td className={cn(table.td, 'sticky left-0 bg-surface-muted')} colSpan={2}>Total</td>
            {shown.map(col => <td key={col.label} className={table.td}>{cell(rows.reduce((s, r) => s + col.value(r), 0), col.less)}</td>)}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
