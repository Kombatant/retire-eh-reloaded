import type { PlannedGift } from '@/types/plan'
import { usePlanStore } from './PlanStoreContext'
import {
  addLegacyGift,
  patchAssumptions,
  removeExpenseItem,
  setInitialWithdrawalRate,
  setLegacyGifts,
  setReplacementRate,
  updateLegacyGift,
} from '@/lib/plan/edits'

// v1-shaped assumptions API over the v2 plan store.
export function useAssumptions() {
  const { legacyAssumptions, updateActivePlan, setUiPrefs } = usePlanStore()

  return {
    ...legacyAssumptions,
    setExpectedReturn: (v: number) => updateActivePlan(p => patchAssumptions(p, { expectedReturn: v })),
    setInflationRate: (v: number) => updateActivePlan(p => patchAssumptions(p, { inflationRate: v })),
    setReplacementRate: (v: number) => updateActivePlan(p => setReplacementRate(p, v)),
    setWithdrawalRate: (v: number) => updateActivePlan(p => setInitialWithdrawalRate(p, v)),
    setShowRealValues: (v: boolean) => setUiPrefs({ showRealValues: v }),
    setWorkingMarginalTaxRate: (v: number) => updateActivePlan(p => patchAssumptions(p, { workingMarginalTaxRate: v })),
    setReinvestRrspRefund: (v: boolean) => updateActivePlan(p => patchAssumptions(p, { reinvestRrspRefund: v })),
    setPlannedGifts: (gifts: PlannedGift[]) => updateActivePlan(p => setLegacyGifts(p, gifts)),
    addGift: (defaultAge = 65) => updateActivePlan(p => addLegacyGift(p, defaultAge)),
    updateGift: (id: string, patch: Partial<Omit<PlannedGift, 'id'>>) => updateActivePlan(p => updateLegacyGift(p, id, patch)),
    removeGift: (id: string) => updateActivePlan(p => removeExpenseItem(p, id)),
  }
}
