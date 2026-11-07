import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { PlanStoreProvider, usePlanStore } from '@/contexts/PlanStoreContext'
import { useAssumptions } from '@/contexts/AssumptionsContext'
import { STORE_KEY } from '@/lib/plan/storage'

function wrapper({ children }: { children: React.ReactNode }) {
  return <PlanStoreProvider>{children}</PlanStoreProvider>
}

describe('PlanStoreProvider', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('persists edits under one versioned key and restores them', () => {
    const first = renderHook(() => ({ store: usePlanStore(), assumptions: useAssumptions() }), { wrapper })
    act(() => {
      first.result.current.assumptions.setExpectedReturn(5.5)
      first.result.current.assumptions.setShowRealValues(false)
    })
    expect(JSON.parse(localStorage.getItem(STORE_KEY)!).schemaVersion).toBe(2)
    first.unmount()

    const second = renderHook(() => useAssumptions(), { wrapper })
    expect(second.result.current.expectedReturn).toBe(5.5)
    expect(second.result.current.showRealValues).toBe(false)
  })

  it('duplicates, renames, selects and deletes plans', () => {
    const { result } = renderHook(() => usePlanStore(), { wrapper })
    const originalId = result.current.activePlan.id

    act(() => result.current.duplicatePlan(originalId))
    expect(result.current.plans).toHaveLength(2)
    const copy = result.current.activePlan
    expect(copy.id).not.toBe(originalId)
    expect(copy.name).toBe('My plan (copy)')

    act(() => result.current.renamePlan(copy.id, 'Retire early'))
    expect(result.current.activePlan.name).toBe('Retire early')

    act(() => result.current.selectPlan(originalId))
    expect(result.current.activePlan.id).toBe(originalId)

    act(() => result.current.deletePlan(originalId))
    expect(result.current.plans).toHaveLength(1)
    expect(result.current.activePlan.id).toBe(copy.id)

    // The last plan can never be deleted.
    act(() => result.current.deletePlan(copy.id))
    expect(result.current.plans).toHaveLength(1)
  })

  it('edits only the active plan', () => {
    const { result } = renderHook(() => ({ store: usePlanStore(), assumptions: useAssumptions() }), { wrapper })
    const originalId = result.current.store.activePlan.id
    act(() => result.current.store.duplicatePlan(originalId))
    act(() => result.current.assumptions.setInflationRate(4))

    const original = result.current.store.plans.find(p => p.id === originalId)!
    expect(original.assumptions.inflationRate).toBe(2.5)
    expect(result.current.store.activePlan.assumptions.inflationRate).toBe(4)
  })
})
