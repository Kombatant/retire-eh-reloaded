import { useEffect, useSyncExternalStore } from 'react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import type { PlanV2 } from '@/lib/plan/schema'
import { runRiskJob, type RiskUpdate } from '@/lib/sim/riskJob'
import { MODEL_VERSION } from '@/lib/sim/funding'

const DEBOUNCE_MS = 300
// Without a Worker (tests, very old browsers) run a small synchronous sample.
const FALLBACK_RUNS = 40
const CACHE_LIMIT = 8
const cache = new Map<string, RiskUpdate>()

function remember(key: string, value: RiskUpdate) {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
}

// One calculation at a time, shared by every component that shows risk
// results. The worker has one pair of listeners for its whole life, so
// cancelled jobs leave nothing behind.
interface JobState {
  key: string
  update: RiskUpdate | null
  running: boolean
  error: string | null
}

let state: JobState | null = null
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
const getState = () => state
function publish(next: JobState | null) {
  state = next
  listeners.forEach(l => l())
}

let worker: Worker | null = null
let nextId = 1
let activeId = 0
let activeKey: string | null = null
let requestedKey: string | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let holders = 0

function fail(key: string | null, message: string) {
  if (key !== null) publish({ key, update: state?.key === key ? state.update : null, running: false, error: message })
  activeId = 0
  requestedKey = null
}

function receive(event: MessageEvent<RiskUpdate & { id: number }>) {
  if (event.data.id !== activeId || activeKey === null) return
  const { id: _ignored, ...update } = event.data
  void _ignored
  if (update.done) remember(activeKey, update)
  publish({ key: activeKey, update, running: !update.done, error: null })
}

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null
  if (!worker) {
    // Some environments refuse a Worker outright; the small sample runs instead.
    try {
      worker = new Worker(new URL('../workers/sim.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      return null
    }
    worker.addEventListener('message', receive)
    worker.addEventListener('error', () => {
      // A crashed worker may not recover; the next request starts a new one.
      worker?.terminate()
      worker = null
      fail(activeKey, 'The risk analysis stopped unexpectedly. Change the plan or reopen this page to try again.')
    })
  }
  return worker
}

function start(key: string, plan: PlanV2, nowYear: number) {
  const id = nextId++
  activeId = id
  activeKey = key
  const w = getWorker()
  if (w) {
    try {
      w.postMessage({ id, plan, startYear: nowYear })
      return
    } catch {
      w.terminate()
      worker = null
    }
  }
  let last: RiskUpdate | null = null
  runRiskJob(plan, nowYear, update => { last = update }, { maxRuns: FALLBACK_RUNS }).then(() => {
    if (!last || activeId !== id) return
    remember(key, last)
    publish({ key, update: last, running: false, error: null })
  }).catch(() => {
    if (activeId === id) fail(key, 'The risk analysis could not be completed.')
  })
}

function cancel() {
  clearTimeout(timer)
  // Tell the worker too: otherwise it keeps computing for nobody.
  if (activeId !== 0) worker?.postMessage({ cancel: true })
  activeId = 0
  activeKey = null
  requestedKey = null
}

// Returns the release function. Components asking for the same plan share one job.
function request(key: string, plan: PlanV2, nowYear: number): () => void {
  holders++
  if (!cache.has(key) && requestedKey !== key) {
    requestedKey = key
    clearTimeout(timer)
    timer = setTimeout(() => start(key, plan, nowYear), DEBOUNCE_MS)
  }
  return () => {
    holders--
    // Deferred so a key change, which releases and re-requests in one commit,
    // keeps the last results on screen until the new ones arrive.
    queueMicrotask(() => {
      if (holders > 0) return
      cancel()
      publish(null)
    })
  }
}

export interface RiskState extends Partial<RiskUpdate> {
  running: boolean
  // These results are from before the latest edit; new ones are on the way.
  stale?: boolean
  error?: string
}

// Monte Carlo, historical backtest and crash scenarios for the active plan,
// computed off the main thread and streamed as batches complete.
export function useRiskAnalysis(): RiskState {
  const { activePlan, nowYear } = usePlanStore()
  const key = `${MODEL_VERSION}:${JSON.stringify(activePlan)}${nowYear}`
  const current = useSyncExternalStore(subscribe, getState)

  useEffect(() => request(key, activePlan, nowYear), [key, activePlan, nowYear])

  const cached = cache.get(key)
  if (cached) return { ...cached, running: false }
  if (current?.key === key) {
    return { ...(current.update ?? {}), running: current.running, error: current.error ?? undefined }
  }
  return { ...(current?.update ?? {}), progress: 0, running: true, stale: Boolean(current?.update) }
}
