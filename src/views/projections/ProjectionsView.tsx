import { useMemo, useState } from 'react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { useProjectionContext } from '@/contexts/ProjectionContext'
import { useAssumptions } from '@/contexts/AssumptionsContext'
import { useSubView } from '@/hooks/useSubView'
import { useDetailLevel } from '@/hooks/useDetailLevel'
import { getPortfolioAtRetirement, giftsAfterRetirement, CPP_BASELINE_AGE, CPP_MIN_START_AGE, maxPensionStartAge, OAS_BASELINE_AGE, OAS_MAX_START_AGE, getCppIncomeAtAge, getOasIncomeAtAge } from '@/lib/calculations'
import { cppAmountAt65, primarySalary } from '@/lib/plan/legacy-view'
import { hasStock } from '@/lib/insights/stockScenarios'
import { buildAccountBreakdown } from '@/lib/insights/accountBreakdown'
import { OAS_MAX_ANNUAL_2026 } from '@/lib/tax'
import { money } from '@/lib/formatting'
import { moneyMode } from '@/lib/ui/money'
import { table } from '@/lib/ui/styles'
import { cn } from '@/lib/ui/cn'
import { PageHeader } from '@/components/ui/PageHeader'
import { SubTabs, type SubTab } from '@/components/ui/SubTabs'
import { Card, CardHeader } from '@/components/ui/Card'
import { Stat } from '@/components/ui/Stat'
import { Badge, MoneyModeBadge } from '@/components/ui/Badge'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Disclosure } from '@/components/ui/Disclosure'
import { StockScenariosCard } from './StockScenariosCard'
import { ContributionChart, DrawdownRatesChart, SpendingLevelsChart } from './charts'
import { AccountBalancesChart, IncomeSourcesChart, IncomeSourcesTable } from './breakdown'

const TABS = ['growth', 'drawdown', 'benefits', 'stocks'] as const
type Tab = typeof TABS[number]

export function ProjectionsView() {
  const { activePlan } = usePlanStore()
  const { showRealValues } = useAssumptions()
  const { isAdvanced } = useDetailLevel()
  const [tab, setTab] = useSubView(TABS, 'growth')
  const showStocks = isAdvanced && hasStock(activePlan)

  const tabs: SubTab<Tab>[] = [
    { value: 'growth', label: 'Saving years' },
    { value: 'drawdown', label: 'Retirement years' },
    { value: 'benefits', label: 'CPP & OAS timing' },
    ...(showStocks ? [{ value: 'stocks' as const, label: 'Stock scenarios' }] : []),
  ]
  const current = tab === 'stocks' && !showStocks ? 'growth' : tab

  return (
    <>
      <PageHeader
        title="Projections"
        description="How your savings grow until retirement and how long they last after, with steady average returns."
        meta={<MoneyModeBadge mode={current === 'benefits' || current === 'stocks' ? 'fixedReal' : moneyMode(showRealValues)} />}
      />
      <SubTabs ariaLabel="Projection views" value={current} onChange={setTab} tabs={tabs}>
        {current === 'growth' && <GrowthPanel />}
        {current === 'drawdown' && <DrawdownPanel />}
        {current === 'benefits' && <BenefitTiming />}
        {current === 'stocks' && <StockScenariosCard />}
      </SubTabs>
    </>
  )
}

type Scenario = 'conservative' | 'expected' | 'optimistic'

function GrowthPanel() {
  const projection = useProjectionContext()
  const assumptions = useAssumptions()
  const [scenario, setScenario] = useState<Scenario>('expected')
  const [view, setView] = useState<'balances' | 'split'>('balances')
  const r = assumptions.expectedReturn

  const data = scenario === 'conservative' ? projection.conservativeProjectionData
    : scenario === 'optimistic' ? projection.optimisticProjectionData
      : projection.currentProjectionData
  const scenarioSim = scenario === 'conservative' ? projection.conservativeSimulation
    : scenario === 'optimistic' ? projection.optimisticSimulation
      : projection.simulation
  const { compiledPlan } = projection
  // Same years as the projection data: today through the first retirement year.
  const breakdown = useMemo(
    () => buildAccountBreakdown(compiledPlan, scenarioSim, assumptions.showRealValues).slice(0, compiledPlan.drawdownStartOffset + 1),
    [compiledPlan, scenarioSim, assumptions.showRealValues],
  )

  if (projection.yearsToRetirement <= 0 || data.length === 0) {
    return <Card><p className="text-sm text-fg-muted">You are already retired, so there are no saving years to project. See Retirement years.</p></Card>
  }

  const atRetirement = getPortfolioAtRetirement(data)
  const start = data[0]?.Total ?? 0

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Stat label="Savings today" value={money(start)} />
        <Stat label={`At retirement (${projection.householdRetirementAge})`} value={money(atRetirement)} sub={`With ${scenario === 'conservative' ? Math.max(0, r - 2) : scenario === 'optimistic' ? r + 2 : r}% returns`} />
        <Stat label="Contributions per year" value={money(projection.totalAnnualContributions)} className="col-span-2 lg:col-span-1" />
      </div>
      <Card>
        <CardHeader
          title={view === 'balances' ? 'Savings by account type' : 'What you put in vs. what it earned'}
          description="Until your planned retirement."
          actions={
            <>
              <SegmentedControl
                ariaLabel="Chart"
                size="sm"
                value={view}
                onChange={setView}
                options={[{ value: 'balances', label: 'By account' }, { value: 'split', label: 'Contributions vs growth' }]}
              />
              <SegmentedControl
                ariaLabel="Return scenario"
                size="sm"
                value={scenario}
                onChange={setScenario}
                options={[
                  { value: 'conservative', label: `${Math.max(0, r - 2)}%`, title: 'Conservative: 2 points below your expected return' },
                  { value: 'expected', label: `${r}%`, title: 'Your expected return' },
                  { value: 'optimistic', label: `${r + 2}%`, title: 'Optimistic: 2 points above your expected return' },
                ]}
              />
            </>
          }
        />
        {view === 'balances'
          ? <AccountBalancesChart rows={breakdown} />
          : <ContributionChart data={data} annualContribution={projection.totalAnnualContributions} showRealValues={assumptions.showRealValues} inflationRate={assumptions.inflationRate} />}
        <Disclosure label="How to read this" className="mt-4">
          <p className="max-w-3xl text-xs leading-relaxed text-fg-muted">
            Savings compound at {r}% a year before inflation, about {(((1 + r / 100) / (1 + assumptions.inflationRate / 100) - 1) * 100).toFixed(1)}% after
            inflation at {assumptions.inflationRate}%. Real markets vary from year to year; the Risk page runs your plan through thousands of
            simulated markets and every historical Canadian start year.
          </p>
        </Disclosure>
      </Card>
    </div>
  )
}

function DrawdownPanel() {
  const projection = useProjectionContext()
  const assumptions = useAssumptions()
  const estate = projection.simulation.estate
  const scale = estate && assumptions.showRealValues ? 1 / estate.cpi : 1
  const data = projection.currentProjectionData
  const startAge = data.length > 0 ? data[data.length - 1].age : projection.householdRetirementAge
  const [sourcesView, setSourcesView] = useState<'chart' | 'table'>('chart')
  const { compiledPlan, simulation } = projection
  // A plan built from a dollar budget starts on dollars; one set as a share of
  // salary starts on percentages.
  const [withdrawalView, setWithdrawalView] = useState<'dollars' | 'rates'>(compiledPlan.expenseMode === 'detailed' ? 'dollars' : 'rates')
  const retired = useMemo(
    () => buildAccountBreakdown(compiledPlan, simulation, assumptions.showRealValues).filter(r => r.phase === 'drawdown'),
    [compiledPlan, simulation, assumptions.showRealValues],
  )

  return (
    <div className="space-y-5">
      {retired.length > 0 && (
        <>
          <Card>
            <CardHeader
              title="Where your money comes from"
              description="Each year of retirement: what you withdraw from each account, plus pensions and government benefits, and what is left to spend after tax."
              actions={
                <SegmentedControl
                  ariaLabel="Show as"
                  size="sm"
                  value={sourcesView}
                  onChange={setSourcesView}
                  options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]}
                />
              }
            />
            {sourcesView === 'chart' ? <IncomeSourcesChart rows={retired} /> : <IncomeSourcesTable rows={retired} />}
            <Disclosure label="How to read this" className="mt-4">
              <p className="max-w-3xl text-xs leading-relaxed text-fg-muted">
                Withdrawals follow your withdrawal order (Plan › Withdrawals) and include required RRIF and LIF minimums.
                When a minimum or a meltdown withdrawal is more than you need, the rest is reinvested after tax, so it shows as
                withdrawn and then reinvested. Hover a year, or switch to the table, to see every source.
              </p>
            </Disclosure>
          </Card>
          <Card>
            <CardHeader title="Savings by account through retirement" description="Balances at the start of each year." />
            <AccountBalancesChart rows={retired} />
          </Card>
        </>
      )}
      <Card>
        <CardHeader
          title={withdrawalView === 'dollars' ? 'Spending more or less' : 'Withdrawal rates'}
          description={withdrawalView === 'dollars'
            ? 'What different yearly spending does to your savings over retirement.'
            : 'What different yearly withdrawals do to your savings over retirement.'}
          actions={
            <SegmentedControl
              ariaLabel="Compare by"
              size="sm"
              value={withdrawalView}
              onChange={setWithdrawalView}
              options={[{ value: 'dollars', label: 'Dollars a year' }, { value: 'rates', label: '% of savings' }]}
            />
          }
        />
        {withdrawalView === 'dollars'
          ? <SpendingLevelsChart compiledPlan={compiledPlan} expectedReturn={assumptions.expectedReturn} showRealValues={assumptions.showRealValues} />
          : (
            <DrawdownRatesChart
              startBalance={getPortfolioAtRetirement(data)}
              expectedReturn={assumptions.expectedReturn}
              inflationRate={assumptions.inflationRate}
              startAge={startAge}
              showRealValues={assumptions.showRealValues}
              plannedGifts={giftsAfterRetirement(assumptions.plannedGifts, projection.householdRetirementAge)}
              minCurrentAge={projection.minCurrentAge}
            />
          )}
      </Card>
      {estate && (
        <Card>
          <CardHeader
            title={`Estate in ${estate.year}`}
            description="At the end of the plan. Registered accounts are taxed as income on the final return and gains are realized (a principal residence is exempt). Accounts pass tax-free to a surviving spouse first."
          />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat bare label="Estate before tax" value={money(estate.grossEstate * scale)} />
            <Stat bare label="Tax on final return" value={`−${money(estate.finalReturnTax * scale)}`} />
            <Stat bare label="Probate" value={`−${money(estate.probate * scale)}`} />
            <Stat bare label="Left to heirs" value={money(estate.afterTaxEstate * scale)} tone="success" />
          </div>
        </Card>
      )}
    </div>
  )
}

const LIFETIME_TO_AGE = 95

function BenefitTiming() {
  const { activePlan, nowYear } = usePlanStore()
  const multi = activePlan.people.length > 1

  return (
    <div className="space-y-5">
      {activePlan.people.map(person => {
        const pension = person.province === 'QC' ? 'QPP' : 'CPP'
        const at65 = cppAmountAt65(person, primarySalary(activePlan, person.id))
        return (
          <Card key={person.id}>
            <CardHeader
              title={multi ? `${person.name} (age ${nowYear - person.birthYear})` : 'Start-age comparison'}
              description="Starting earlier gives more years of payments; starting later gives a permanently larger amount. Before tax and OAS clawback."
              actions={<Badge>{pension} {person.cppStartAge} · OAS {person.oas.startAge}</Badge>}
            />
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <BenefitTable
                title={pension}
                ages={[CPP_MIN_START_AGE, 62, CPP_BASELINE_AGE, 67, maxPensionStartAge(person.province)]}
                annualAt={(age) => getCppIncomeAtAge(at65, age, age, maxPensionStartAge(person.province))}
                selected={person.cppStartAge}
              />
              <BenefitTable
                title="OAS"
                ages={[OAS_BASELINE_AGE, 67, OAS_MAX_START_AGE]}
                annualAt={(age) => getOasIncomeAtAge(OAS_MAX_ANNUAL_2026, age, age)}
                selected={person.oas.startAge}
              />
            </div>
          </Card>
        )
      })}
      <p className="text-xs text-fg-muted">
        "Paid to {LIFETIME_TO_AGE}" adds up payments from the start age to {LIFETIME_TO_AGE} without inflation, tax or discounting. Both benefits rise
        with inflation. Change your start ages under Plan › Household.
      </p>
    </div>
  )
}

function BenefitTable({ title, ages, annualAt, selected }: {
  title: string
  ages: number[]
  annualAt: (age: number) => number
  selected: number
}) {
  const rows = [...new Set([...ages, selected])].sort((a, b) => a - b).map(age => {
    const annual = annualAt(age)
    return { age, annual, lifetime: annual * Math.max(0, LIFETIME_TO_AGE - age) }
  })
  const baseline = annualAt(65)
  const best = Math.max(...rows.map(r => r.lifetime))
  return (
    <div>
      <h3 className="mb-2 text-[13px] font-semibold text-fg">{title}</h3>
      <div className={table.wrap}>
        <table className={table.table}>
          <thead className={table.thead}>
            <tr>
              <th className={table.th}>Start at</th>
              <th className={table.th}>Per year</th>
              <th className={table.th}>vs. 65</th>
              <th className={table.th}>Paid to {LIFETIME_TO_AGE}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const change = baseline > 0 ? r.annual / baseline - 1 : 0
              const isSelected = r.age === selected
              return (
                <tr key={r.age} className={cn(table.tr, isSelected && 'bg-accent-subtle')}>
                  <td className={cn(table.td, 'font-medium text-fg')}>
                    {r.age}{isSelected && <span className="ml-2 text-xs font-normal text-accent">your plan</span>}
                  </td>
                  <td className={table.td}>{money(r.annual)}</td>
                  <td className={table.td}>{Math.abs(change) < 0.005 ? '—' : `${change > 0 ? '+' : ''}${Math.round(change * 100)}%`}</td>
                  <td className={cn(table.td, r.lifetime === best && 'font-medium text-fg')}>{money(r.lifetime)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
