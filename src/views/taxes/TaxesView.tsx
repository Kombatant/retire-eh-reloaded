import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useAssumptions } from '@/contexts/AssumptionsContext'
import { useProjectionContext } from '@/contexts/ProjectionContext'
import { useSubView } from '@/hooks/useSubView'
import { bracketPosition } from '@/lib/insights/brackets'
import { jurisdictionLabel } from '@/lib/tax'
import { money, moneyCompact } from '@/lib/formatting'
import { axisProps, barTooltipProps, chartColors, gridProps } from '@/lib/ui/chartTheme'
import { moneyMode } from '@/lib/ui/money'
import { table } from '@/lib/ui/styles'
import { cn } from '@/lib/ui/cn'
import { PageHeader } from '@/components/ui/PageHeader'
import { SubTabs } from '@/components/ui/SubTabs'
import { Card, CardHeader } from '@/components/ui/Card'
import { Stat } from '@/components/ui/Stat'
import { MoneyModeBadge } from '@/components/ui/Badge'
import { Select } from '@/components/ui/inputs'
import { Disclosure } from '@/components/ui/Disclosure'
import { EmptyState } from '@/components/ui/EmptyState'
import { Advanced } from '@/components/ui/Advanced'
import { Receipt } from 'lucide-react'

const TABS = ['retirement', 'by-year', 'brackets'] as const

export function TaxesView() {
  const { showRealValues } = useAssumptions()
  const [tab, setTab] = useSubView(TABS, 'retirement')

  return (
    <>
      <PageHeader
        title="Taxes"
        description="Income tax, the OAS clawback and how much room is left in your bracket, using 2026 federal and provincial rules."
        meta={<MoneyModeBadge mode={moneyMode(showRealValues)} />}
      />
      <SubTabs
        ariaLabel="Tax views"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'retirement', label: 'At retirement' },
          { value: 'by-year', label: 'By year' },
          { value: 'brackets', label: 'Bracket room' },
        ]}
      >
        {tab === 'retirement' && <RetirementTaxes />}
        {tab === 'by-year' && <TaxByYear />}
        {tab === 'brackets' && <BracketRoom />}
      </SubTabs>
    </>
  )
}

function RetirementTaxes() {
  const projection = useProjectionContext()
  const tax = projection.retirementTax
  if (!tax) {
    return <Card><EmptyState icon={Receipt} title="No retirement tax estimate yet" description="Add income or savings to see your tax in retirement." /></Card>
  }
  const jurisdiction = jurisdictionLabel(tax.perPerson.map(p => p.province))
  const anySplit = tax.perPerson.some(p => Math.abs(p.pensionSplit) > 1)
  const people = tax.perPerson
  const sum = (pick: (p: typeof people[number]) => number) => people.reduce((s, p) => s + pick(p), 0)
  const multi = tax.perPerson.length > 1

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Income before tax" value={money(tax.preTaxIncome)} sub="First year of retirement" />
        <Stat label="Total tax" value={money(tax.totalTax)} sub="Including OAS clawback" />
        <Stat label="Income after tax" value={money(tax.afterTaxIncome)} sub={`Includes ${money(tax.taxFreeWithdrawal)} from TFSAs`} />
        <Stat
          label="Average / top rate"
          value={`${tax.averageTaxRate.toFixed(1)}% / ${tax.topMarginalRate.toFixed(1)}%`}
          info="Average rate is total tax over gross income. Top rate is the highest marginal rate in the household."
        />
      </div>

      <Card padding="none">
        <div className="p-4 sm:p-5">
          <CardHeader
            className="mb-0"
            title={`Tax at retirement (age ${projection.householdRetirementAge})`}
            description={`2026 federal and ${jurisdiction} rules. RRSP/RRIF withdrawals are taxed to the account owner${anySplit ? ', with pension income splitting where it lowers household tax' : ''}.`}
          />
        </div>
        <div className="overflow-x-auto border-t border-border">
          <table className={cn(table.table, 'min-w-[760px]')}>
            <thead className={table.thead}>
              <tr>
                {['Person', 'Pension', 'CPP', 'OAS', 'RRSP/RRIF', 'Taxable', 'Federal', 'Provincial', 'Clawback', 'Total tax', 'Marginal'].map(h => (
                  <th key={h} className={table.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tax.perPerson.map(p => (
                <tr key={p.name} className={table.tr}>
                  <td className={cn(table.td, 'font-medium text-fg')}>{p.name}</td>
                  <td className={table.td}>{money(p.pension)}</td>
                  <td className={table.td}>{money(p.cpp)}</td>
                  <td className={table.td}>{money(p.oas)}</td>
                  <td className={table.td}>{money(p.rrifWithdrawal)}</td>
                  <td className={table.td}>{money(p.taxableIncome)}</td>
                  <td className={table.td}>{money(p.federal)}</td>
                  <td className={table.td}>{money(p.provincial)}</td>
                  <td className={table.td}>{money(p.oasClawback)}</td>
                  <td className={cn(table.td, 'font-medium text-fg')}>{money(p.total)}</td>
                  <td className={table.td}>{p.marginalRate.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
            {multi && (
              <tfoot className={table.tfoot}>
                <tr>
                  <td className={table.td}>Household</td>
                  <td className={table.td}>{money(sum(p => p.pension))}</td>
                  <td className={table.td}>{money(sum(p => p.cpp))}</td>
                  <td className={table.td}>{money(sum(p => p.oas))}</td>
                  <td className={table.td}>{money(tax.taxableWithdrawal)}</td>
                  <td className={table.td}>{money(sum(p => p.taxableIncome))}</td>
                  <td className={table.td}>{money(sum(p => p.federal))}</td>
                  <td className={table.td}>{money(sum(p => p.provincial))}</td>
                  <td className={table.td}>{money(tax.oasClawback)}</td>
                  <td className={table.td}>{money(tax.totalTax)}</td>
                  <td className={table.td}>{tax.topMarginalRate.toFixed(1)}%</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <div className="border-t border-border p-4 sm:p-5">
          <Disclosure label="What's included">
            <p className="max-w-3xl text-xs leading-relaxed text-fg-muted">
              Estimates only. Includes the main federal and provincial credits (basic, age, pension income), the OAS clawback, GIS,
              and pension income splitting (up to 50% of eligible pension income; RRIF income from age 65). TFSA withdrawals are
              tax-free and not taxable income, so the household's after-tax income also includes {money(tax.taxFreeWithdrawal)} from TFSAs.
            </p>
          </Disclosure>
        </div>
      </Card>
    </div>
  )
}

function TaxByYear() {
  const { simulation } = useProjectionContext()
  const { showRealValues } = useAssumptions()
  const series = useMemo(() => simulation.rows.map(r => ({
    year: r.year,
    tax: r.tax / (showRealValues ? r.cpi : 1),
    rate: r.grossIncome > 0 ? (r.tax / r.grossIncome) * 100 : 0,
  })), [simulation.rows, showRealValues])
  const lifetime = series.reduce((s, r) => s + r.tax, 0)
  const estate = simulation.estate
  const finalReturn = estate ? estate.finalReturnTax * (showRealValues ? 1 / estate.cpi : 1) : 0

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Stat label="Lifetime income tax" value={moneyCompact(lifetime)} sub="Every year of the plan" />
        <Stat label="Tax on final return" value={moneyCompact(finalReturn)} sub="Registered accounts and gains at death" />
        <Stat label="Total" value={moneyCompact(lifetime + finalReturn)} className="col-span-2 lg:col-span-1" />
      </div>
      <Card>
        <CardHeader title="Income tax by year" description="Federal and provincial tax, payroll deductions and the OAS clawback." />
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={1}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="year" {...axisProps} minTickGap={24} />
              <YAxis {...axisProps} width={56} tickFormatter={(v: number) => moneyCompact(v)} />
              <Tooltip
                {...barTooltipProps}
                formatter={(value, _n, item) => [`${money(Number(value))} (${item.payload.rate.toFixed(1)}% of income)`, 'Tax']}
              />
              <Bar dataKey="tax" fill={chartColors.tax} radius={[2, 2, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  )
}

function BracketRoom() {
  const { compiledPlan, simulation } = useProjectionContext()
  const { showRealValues } = useAssumptions()
  const rows = simulation.rows
  const [selected, setSelected] = useState<number | null>(null)
  const index = Math.min(rows.length - 1, Math.max(0, selected ?? compiledPlan.drawdownStartOffset))
  const row = rows[index]
  const scale = showRealValues ? 1 / row.cpi : 1

  return (
    <Card>
      <CardHeader
        title="Room in the current bracket"
        description="The combined rate on the next dollar of taxable income, and how much more fits before it changes. Useful for planning RRSP withdrawals."
        actions={
          <Select size="sm" aria-label="Year" value={index} onChange={(e) => setSelected(Number(e.target.value))} className="w-40">
            {rows.map((r, i) => <option key={r.year} value={i}>{r.year}{i === compiledPlan.drawdownStartOffset ? ' (retire)' : ''}</option>)}
          </Select>
        }
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {row.people.map((p, i) => {
          if (!p.alive) return null
          const person = compiledPlan.people[i]
          const position = bracketPosition(p.taxableIncome / row.cpi, person.province)
          return (
            <Stat
              key={person.id}
              label={`${person.name}, age ${p.age}`}
              value={`${position.marginalRatePct.toFixed(1)}%`}
              sub={
                <>
                  Taxable income {money(p.taxableIncome * scale)}
                  {position.room !== null && <> · {money(position.room * (showRealValues ? 1 : row.cpi))} until the rate changes</>}
                </>
              }
            />
          )
        })}
      </div>
      <Advanced>
        <p className="mt-4 text-xs text-fg-muted">
          Statutory bracket rates only. Credits that phase out and the OAS clawback can make the effective rate on the next dollar higher.
        </p>
      </Advanced>
    </Card>
  )
}
