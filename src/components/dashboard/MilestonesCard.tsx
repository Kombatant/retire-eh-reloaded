import { useMemo } from 'react'
import { CalendarClock } from 'lucide-react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { useProjectionContext } from '@/contexts/ProjectionContext'
import { useRiskAnalysis } from '@/hooks/useRiskAnalysis'
import { fiMetrics } from '@/lib/insights/fi'
import { buildMilestones } from '@/lib/insights/milestones'
import { InfoTooltip } from './InfoTooltip'

// Financial-independence dates, chance of success and the plan timeline.
export function MilestonesCard() {
  const { activePlan, nowYear } = usePlanStore()
  const { compiledPlan, simulation } = useProjectionContext()
  const risk = useRiskAnalysis()
  const fi = useMemo(() => fiMetrics(activePlan, nowYear), [activePlan, nowYear])
  const milestones = useMemo(() => buildMilestones(activePlan, compiledPlan, simulation, fi), [activePlan, compiledPlan, simulation, fi])
  const success = risk.monteCarlo ? Math.round(risk.monteCarlo.successRate * 100) : null

  const tiles = [
    {
      label: 'Chance of success',
      value: success === null ? '…' : `${success}%`,
      help: 'Share of simulated markets in which every year of the plan is funded (see the Risk tab).',
    },
    {
      label: 'Financially independent',
      value: fi.fiYear ? String(fi.fiYear) : fi.onTrack ? '—' : 'Not yet',
      help: 'Earliest year everyone could stop working and the plan would still be funded with average returns.',
    },
    {
      label: 'Coast FI',
      value: fi.coastYear ? String(fi.coastYear) : fi.onTrack ? '—' : 'Not yet',
      help: 'Earliest year you could stop saving for retirement, keep working until your planned retirement, and still be funded.',
    },
  ]

  return (
    <div className="animate-fade-in-up card p-6">
      <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4 flex items-center gap-2">
        <CalendarClock className="w-5 h-5 text-primary" />
        Milestones
      </h2>
      <dl className="grid grid-cols-3 gap-3 mb-5">
        {tiles.map(t => (
          <div key={t.label} className="rounded-lg bg-gray-50 dark:bg-gray-800/60 p-3">
            <dt className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{t.label}<InfoTooltip text={t.help} /></dt>
            <dd className="mt-0.5 text-xl font-semibold tabular-nums text-gray-900 dark:text-white">{t.value}</dd>
          </div>
        ))}
      </dl>
      <ol className="relative border-l border-gray-200 dark:border-gray-700 ml-2 space-y-2">
        {milestones.map(m => (
          <li key={`${m.year}-${m.label}`} className="ml-4">
            <span className={`absolute -left-1.5 mt-1.5 w-3 h-3 rounded-full border-2 border-white dark:border-gray-900 ${m.kind === 'risk' ? 'bg-rose-500' : m.kind === 'fi' ? 'bg-emerald-500' : 'bg-indigo-500'}`} aria-hidden />
            <span className="text-sm tabular-nums font-medium text-gray-900 dark:text-gray-100 mr-2">{m.year}</span>
            <span className="text-sm text-gray-700 dark:text-gray-300">{m.label}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
