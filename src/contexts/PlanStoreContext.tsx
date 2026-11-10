import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react'
import type { Person } from '@/types/person'
import type { PlanAssumptions } from '@/types/plan'
import type { PlanV2, UiPrefs } from '@/lib/plan/schema'
import {
  acknowledgeRecovery,
  browserStorage,
  loadStoreWithRecovery,
  preserveRecovery,
  readRecoveryEntries,
  serializeStore,
  storeSaveProblem,
  STORE_KEY,
  type Baseline,
  type RecoveryEntry,
  type Snapshot,
  type StoreState,
} from '@/lib/plan/storage'
import { toLegacyAssumptions, toLegacyPeople } from '@/lib/plan/legacy-view'
import { newId } from '@/lib/plan/ids'

type StoreAction =
  | { type: 'UPDATE_ACTIVE'; update: (plan: PlanV2) => PlanV2 }
  | { type: 'UPDATE_PLAN'; id: string; update: (plan: PlanV2) => PlanV2 }
  | { type: 'REPLACE_ACTIVE'; plan: PlanV2 }
  | { type: 'ADD_PLAN'; plan: PlanV2 }
  | { type: 'SELECT_PLAN'; id: string }
  | { type: 'DELETE_PLAN'; id: string }
  | { type: 'RENAME_PLAN'; id: string; name: string }
  | { type: 'SET_UI_PREFS'; patch: Partial<UiPrefs> }
  | { type: 'ADD_SNAPSHOT'; snapshot: Snapshot }
  | { type: 'DELETE_SNAPSHOT'; id: string }
  | { type: 'SET_BASELINE'; baseline: Baseline }

function storeReducer(state: StoreState, action: StoreAction): StoreState {
  switch (action.type) {
    case 'UPDATE_ACTIVE':
      return {
        ...state,
        plans: state.plans.map(p => (p.id === state.activePlanId ? action.update(p) : p)),
      }
    case 'UPDATE_PLAN':
      return { ...state, plans: state.plans.map(p => (p.id === action.id ? action.update(p) : p)) }
    case 'REPLACE_ACTIVE':
      // A replacement takes over the active slot but keeps its identity, so
      // tracking data tied to that plan stays attached to it.
      return {
        ...state,
        plans: state.plans.map(p => (p.id === state.activePlanId ? { ...action.plan, id: p.id } : p)),
      }
    case 'ADD_PLAN':
      return { ...state, plans: [...state.plans, action.plan], activePlanId: action.plan.id }
    case 'SELECT_PLAN':
      return state.plans.some(p => p.id === action.id) ? { ...state, activePlanId: action.id } : state
    case 'DELETE_PLAN': {
      if (state.plans.length <= 1) return state
      const plans = state.plans.filter(p => p.id !== action.id)
      const activePlanId = state.activePlanId === action.id ? plans[0].id : state.activePlanId
      return {
        ...state,
        plans,
        activePlanId,
        snapshots: state.snapshots.filter(s => s.planId !== action.id),
        baselines: state.baselines.filter(b => b.planId !== action.id),
      }
    }
    case 'RENAME_PLAN':
      return { ...state, plans: state.plans.map(p => (p.id === action.id ? { ...p, name: action.name } : p)) }
    case 'SET_UI_PREFS':
      return { ...state, uiPrefs: { ...state.uiPrefs, ...action.patch } }
    case 'ADD_SNAPSHOT':
      return { ...state, snapshots: [...state.snapshots, action.snapshot].sort((a, b) => a.date.localeCompare(b.date)) }
    case 'DELETE_SNAPSHOT':
      return { ...state, snapshots: state.snapshots.filter(s => s.id !== action.id) }
    case 'SET_BASELINE':
      return { ...state, baselines: [...state.baselines.filter(b => b.planId !== action.baseline.planId), action.baseline] }
  }
}

interface PlanStoreValue {
  plans: PlanV2[]
  activePlan: PlanV2
  uiPrefs: UiPrefs
  // Calendar year the projection starts in; ages are derived from birth years.
  nowYear: number
  now: Date
  legacyPeople: Person[]
  legacyAssumptions: PlanAssumptions
  storageError: string | null
  clearStorageError: () => void
  // Set while edits cannot be saved because a plan holds an invalid value.
  saveProblem: string | null
  // Stored data that could not be read; an untouched copy is kept.
  recoveryEntries: RecoveryEntry[]
  acknowledgeRecoveryEntries: () => void
  updateActivePlan: (update: (plan: PlanV2) => PlanV2) => void
  // For results that arrive later: they must go to the plan that asked.
  updatePlan: (id: string, update: (plan: PlanV2) => PlanV2) => void
  replaceActivePlan: (plan: PlanV2) => void
  addPlan: (plan: PlanV2) => void
  duplicatePlan: (id: string) => void
  selectPlan: (id: string) => void
  deletePlan: (id: string) => void
  renamePlan: (id: string, name: string) => void
  setUiPrefs: (patch: Partial<UiPrefs>) => void
  selectedPersonId: string | null
  setSelectedPersonId: (id: string | null) => void
  snapshots: Snapshot[]
  baselines: Baseline[]
  addSnapshot: (snapshot: Snapshot) => void
  deleteSnapshot: (id: string) => void
  setBaseline: (baseline: Baseline) => void
}

const PlanStoreContext = createContext<PlanStoreValue | null>(null)

function storageErrorMessage(error: unknown): string {
  return error instanceof DOMException && error.name === 'QuotaExceededError'
    ? 'Storage is full. Your data could not be saved. Try removing old data or exporting your plan.'
    : 'Failed to save data. Your changes may not persist.'
}

export function PlanStoreProvider({ children, now: nowProp }: { children: ReactNode; now?: Date }) {
  const [now] = useState(() => nowProp ?? new Date())
  const [boot] = useState(() => {
    const loaded = loadStoreWithRecovery(browserStorage(), now)
    return {
      state: loaded.state,
      unavailable: loaded.unavailable,
      canOverwrite: !loaded.unavailable && (loaded.recovery ? preserveRecovery(browserStorage(), loaded.recovery, now) : true),
    }
  })
  const [state, dispatch] = useReducer(storeReducer, boot.state)
  const [storageError, setStorageError] = useState<string | null>(() => {
    if (boot.unavailable) return 'Your browser is blocking storage, so this is an unsaved session. Your changes last until you close this tab; export your plan from the ⋯ menu to keep it.'
    return boot.canOverwrite ? null : 'Some saved data could not be read or backed up, so nothing is being saved. Free up browser storage and reload.'
  })
  const [recoveryEntries, setRecoveryEntries] = useState<RecoveryEntry[]>(() =>
    readRecoveryEntries(browserStorage()).filter(e => !e.acknowledged))
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null)
  const nowYear = now.getFullYear()

  const serialized = useMemo(() => serializeStore(state), [state])
  const saveProblem = useMemo(() => (serialized === null ? storeSaveProblem(state) : null), [serialized, state])

  useEffect(() => {
    if (serialized === null || !boot.canOverwrite) return
    try {
      localStorage.setItem(STORE_KEY, serialized)
    } catch (error) {
      console.error('localStorage write failed:', error)
      queueMicrotask(() => setStorageError(storageErrorMessage(error)))
    }
  }, [serialized, boot.canOverwrite])

  const activePlan = state.plans.find(p => p.id === state.activePlanId) ?? state.plans[0]
  const legacyPeople = useMemo(() => toLegacyPeople(activePlan, nowYear), [activePlan, nowYear])
  const legacyAssumptions = useMemo(
    () => toLegacyAssumptions(activePlan, state.uiPrefs, nowYear),
    [activePlan, state.uiPrefs, nowYear],
  )

  const effectiveSelectedId = activePlan.people.some(p => p.id === selectedPersonId)
    ? selectedPersonId
    : activePlan.people[0]?.id ?? null

  const updateActivePlan = useCallback((update: (plan: PlanV2) => PlanV2) => dispatch({ type: 'UPDATE_ACTIVE', update }), [])
  const updatePlan = useCallback((id: string, update: (plan: PlanV2) => PlanV2) => dispatch({ type: 'UPDATE_PLAN', id, update }), [])
  const replaceActivePlan = useCallback((plan: PlanV2) => dispatch({ type: 'REPLACE_ACTIVE', plan }), [])
  const addPlan = useCallback((plan: PlanV2) => dispatch({ type: 'ADD_PLAN', plan }), [])
  const selectPlan = useCallback((id: string) => dispatch({ type: 'SELECT_PLAN', id }), [])
  const deletePlan = useCallback((id: string) => dispatch({ type: 'DELETE_PLAN', id }), [])
  const renamePlan = useCallback((id: string, name: string) => dispatch({ type: 'RENAME_PLAN', id, name }), [])
  const setUiPrefs = useCallback((patch: Partial<UiPrefs>) => dispatch({ type: 'SET_UI_PREFS', patch }), [])
  const duplicatePlan = useCallback((id: string) => {
    const source = state.plans.find(p => p.id === id)
    if (!source) return
    dispatch({ type: 'ADD_PLAN', plan: { ...structuredClone(source), id: newId('plan'), name: `${source.name} (copy)` } })
  }, [state.plans])
  const clearStorageError = useCallback(() => setStorageError(null), [])
  const acknowledgeRecoveryEntries = useCallback(() => {
    acknowledgeRecovery(browserStorage())
    setRecoveryEntries([])
  }, [])
  const addSnapshot = useCallback((snapshot: Snapshot) => dispatch({ type: 'ADD_SNAPSHOT', snapshot }), [])
  const deleteSnapshot = useCallback((id: string) => dispatch({ type: 'DELETE_SNAPSHOT', id }), [])
  const setBaseline = useCallback((baseline: Baseline) => dispatch({ type: 'SET_BASELINE', baseline }), [])

  const value: PlanStoreValue = {
    plans: state.plans,
    activePlan,
    uiPrefs: state.uiPrefs,
    nowYear,
    now,
    legacyPeople,
    legacyAssumptions,
    storageError,
    clearStorageError,
    saveProblem,
    recoveryEntries,
    acknowledgeRecoveryEntries,
    updateActivePlan,
    updatePlan,
    replaceActivePlan,
    addPlan,
    duplicatePlan,
    selectPlan,
    deletePlan,
    renamePlan,
    setUiPrefs,
    selectedPersonId: effectiveSelectedId,
    setSelectedPersonId,
    snapshots: state.snapshots,
    baselines: state.baselines,
    addSnapshot,
    deleteSnapshot,
    setBaseline,
  }

  return <PlanStoreContext.Provider value={value}>{children}</PlanStoreContext.Provider>
}

export function usePlanStore(): PlanStoreValue {
  const ctx = useContext(PlanStoreContext)
  if (!ctx) throw new Error('usePlanStore must be used within PlanStoreProvider')
  return ctx
}
