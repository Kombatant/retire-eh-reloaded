import { useMemo } from 'react'
import { CheckCircle2, LineChart, XCircle } from 'lucide-react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { compareStockScenarios, hasSalePlan, hasStock, type StockOutcome } from '@/lib/insights/stockScenarios'
import { formatMoney } from '@/lib/formatting'

const LABELS = { bear: 'Bear', base: 'Base', bull: 'Bull' } as const

function Funded({ outcome }: { outcome: StockOutcome }) {
  return outcome.success
    ? <span className="inline-flex items-center gap-1"><CheckCircle2 className="w-4 h-4 text-emerald-600" aria-hidden />Funded</span>
    : <span className="inline-flex items-center gap-1"><XCircle className="w-4 h-4 text-rose-600" aria-hidden />Short in {outcome.firstShortfallYear}</span>
}

const money = (value: number) => `$${formatMoney(value)}`

// Bear / base / bull price cases for the stock portfolio, with and without
// the planned yearly sales. All amounts in today's dollars.
export function StockScenariosCard() {
  const { activePlan, nowYear } = usePlanStore()
  const rows = useMemo(() => (hasStock(activePlan) ? compareStockScenarios(activePlan, nowYear) : []), [activePlan, nowYear])
  if (rows.length === 0) return null
  const selling = hasSalePlan(activePlan)
  const selected = activePlan.assumptions.stockScenario

  const columns: { label: string; value: (o: StockOutcome) => React.ReactNode }[] = [
    { label: 'Stock at retirement', value: o => money(o.stockAtRetirement) },
    { label: 'Stock sold over the plan', value: o => money(o.totalSales) },
    { label: 'Stock left at the end', value: o => money(o.stockAtEnd) },
    { label: 'Lifetime tax', value: o => money(o.lifetimeTax) },
    { label: 'Retirement', value: o => <Funded outcome={o} /> },
    { label: 'After-tax estate', value: o => money(o.afterTaxEstate) },
  ]

  return (
    <div className="card p-4 sm:p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-800 dark:text-white">
        <LineChart className="w-5 h-5 text-indigo-500" />
        Stock price scenarios
      </h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Each stock's bear, base and bull growth{selling ? ', with your sell plan and with no planned sales' : ''}. Today's dollars, average markets for everything else.
        Projections elsewhere use the <strong>{LABELS[selected].toLowerCase()}</strong> case.
      </p>
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800/60 text-left text-xs text-gray-500 dark:text-gray-400">
            <tr>
              <th className="px-3 py-2">Case</th>
              {columns.map(c => <th key={c.label} className="px-3 py-2 text-right font-medium">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.flatMap(r => {
              const variants: [string, StockOutcome][] = selling
                ? [['with sell plan', r.withPlan], ['no planned sales', r.noSales]]
                : [['', r.withPlan]]
              return variants.map(([variant, outcome], i) => (
                <tr
                  key={`${r.scenario}-${variant}`}
                  className={`border-t border-gray-100 dark:border-gray-700/60 text-gray-700 dark:text-gray-300 ${r.scenario === selected && i === 0 ? 'bg-indigo-50/60 dark:bg-indigo-900/20' : ''}`}
                >
                  <td className="px-3 py-2 whitespace-nowrap">
                    {i === 0 && <span className="font-medium text-gray-900 dark:text-gray-100">{LABELS[r.scenario]}</span>}
                    {variant && <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">{variant}</span>}
                  </td>
                  {columns.map(c => <td key={c.label} className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{c.value(outcome)}</td>)}
                </tr>
              ))
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
