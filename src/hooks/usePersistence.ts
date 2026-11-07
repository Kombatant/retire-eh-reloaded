import { usePlanStore } from '@/contexts/PlanStoreContext'

// Persistence now lives in PlanStoreProvider (one versioned localStorage key).
// This hook only surfaces write errors to the layout.
export function usePersistence() {
  const { storageError, clearStorageError } = usePlanStore()
  return {
    localStorageError: storageError,
    setLocalStorageError: (value: string | null) => {
      if (value === null) clearStorageError()
    },
  }
}
