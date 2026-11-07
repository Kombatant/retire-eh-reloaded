import { Landmark } from 'lucide-react'
import { useAssumptions } from '@/contexts/AssumptionsContext'
import { useProjectionContext } from '@/contexts/ProjectionContext'
import { formatMoney } from '@/lib/formatting'
import { ModeBadge } from '@/components/ui/ModeBadge'

// What the household leaves behind at the end of the plan.
export function EstateCard() {
  const { showRealValues } = useAssumptions()
  const { simulation } = useProjectionContext()
  const estate = simulation.estate
  if (!estate) return null
  const scale = showRealValues ? 1 / estate.cpi : 1

  const items = [
    { label: 'Estate before tax', value: estate.grossEstate, tone: 'text-gray-900 dark:text-white' },
    { label: 'Tax on final return', value: -estate.finalReturnTax, tone: 'text-rose-600 dark:text-rose-400' },
    { label: 'Probate', value: -estate.probate, tone: 'text-rose-600 dark:text-rose-400' },
    { label: 'Left to heirs', value: estate.afterTaxEstate, tone: 'text-emerald-700 dark:text-emerald-400 font-semibold' },
  ]

  return (
    <div className="animate-fade-in-up card p-6">
      <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-1 flex items-center gap-2">
        <Landmark className="w-5 h-5 text-primary" />
        Estate in {estate.year}
        <ModeBadge showRealValues={showRealValues} />
      </h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        At the end of the plan. Registered accounts are taxed as income on the final return and unrealized gains are
        realized (a principal residence is exempt). Accounts roll over tax-free to a surviving spouse at the first death.
      </p>
      <dl className="grid grid-cols-2 gap-3">
        {items.map(item => (
          <div key={item.label} className="rounded-lg bg-gray-50 dark:bg-gray-800/60 p-3">
            <dt className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{item.label}</dt>
            <dd className={`mt-0.5 text-lg ${item.tone}`}>
              {item.value < 0 ? '−' : ''}${formatMoney(Math.abs(item.value) * scale)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
