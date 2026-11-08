import { useMemo } from 'react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { useDetailLevel } from '@/hooks/useDetailLevel'
import { advancedSettingsInUse } from '@/lib/plan/advanced'
import type { PlanSection } from '@/lib/ui/route'
import { Callout } from '@/components/ui/Callout'
import { Button } from '@/components/ui/Button'

// In Essentials mode, says when settings hidden in this section still apply.
export function AdvancedNotice({ section }: { section: PlanSection }) {
  const { activePlan } = usePlanStore()
  const { isAdvanced, setDetailLevel } = useDetailLevel()
  const active = useMemo(
    () => advancedSettingsInUse(activePlan).filter(s => s.section === section),
    [activePlan, section],
  )
  if (isAdvanced || active.length === 0) return null

  return (
    <Callout
      tone="info"
      title={active.length === 1 ? '1 advanced setting is active' : `${active.length} advanced settings are active`}
      actions={<Button size="sm" onClick={() => setDetailLevel('advanced')}>Show</Button>}
    >
      {active.map(s => s.label).join(' · ')}. They are hidden in Essentials mode but still used in your plan.
    </Callout>
  )
}
