import { useMemo } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { compareStockScenarios, hasSalePlan, hasStock, type StockOutcome } from '@/lib/insights/stockScenarios'
import { formatMoney } from '@/lib/formatting'

const LABELS = { bear: 'Bear', base: 'Base', bull: 'Bull' } as const

function Funded({ outcome }: { outcome: StockOutcome }) {
  return outcome.success
    ? <span className="inline-flex items-center gap-1"><CheckCircle2 className="w-4 h-4 text-success" aria-hidden />Funded</span>
    : <span className="inline-flex items-center gap-1"><XCircle className="w-4 h-4 text-danger" aria-hidden />Short in {outcome.firstShortfallYear}</span>
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
    <div className="rounded-xl border border-border bg-surface p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-5">
      <h2 className="text-[15px] font-semibold text-fg">Stock price scenarios</h2>
      <p className="mt-0.5 mb-4 text-[13px] text-fg-muted">
        Each stock's bear, base and bull growth{selling ? ', with your sell plan and with no planned sales' : ''}. Today's dollars, average markets for everything else.
        Projections elsewhere use the <strong>{LABELS[selected].toLowerCase()}</strong> case.
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-surface-muted text-left text-xs text-fg-muted">
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
                  className={`border-t border-border text-fg-secondary ${r.scenario === selected && i === 0 ? 'bg-accent-subtle' : ''}`}
                >
                  <td className="px-3 py-2 whitespace-nowrap">
                    {i === 0 && <span className="font-medium text-fg">{LABELS[r.scenario]}</span>}
                    {variant && <span className="ml-1 text-xs text-fg-muted">{variant}</span>}
                  </td>
                  {columns.map(c => <td key={c.label} className="px-3 py-2 text-right whitespace-nowrap">{c.value(outcome)}</td>)}
                </tr>
              ))
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
