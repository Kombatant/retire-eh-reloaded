import { useCallback } from 'react'
import { usePlanStore } from '@/contexts/PlanStoreContext'

export type DetailLevel = 'essentials' | 'advanced'

// Essentials / Advanced mode. Hiding an input never changes its value; the
// plan keeps using it, and sections say when hidden settings are active.
export function useDetailLevel() {
  const { uiPrefs, setUiPrefs } = usePlanStore()
  const setDetailLevel = useCallback((detailLevel: DetailLevel) => setUiPrefs({ detailLevel }), [setUiPrefs])
  return {
    detailLevel: uiPrefs.detailLevel,
    isAdvanced: uiPrefs.detailLevel === 'advanced',
    setDetailLevel,
  }
}
