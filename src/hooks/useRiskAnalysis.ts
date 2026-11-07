import { useEffect, useRef, useState } from 'react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { runRiskJob, type RiskUpdate } from '@/lib/sim/riskJob'

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

let worker: Worker | null = null
let nextId = 1

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null
  if (!worker) worker = new Worker(new URL('../workers/sim.worker.ts', import.meta.url), { type: 'module' })
  return worker
}

export interface RiskState extends Partial<RiskUpdate> {
  running: boolean
}

// Monte Carlo, historical backtest and crash scenarios for the active plan,
// computed off the main thread and streamed as batches complete.
export function useRiskAnalysis(): RiskState {
  const { activePlan, nowYear } = usePlanStore()
  const key = JSON.stringify(activePlan) + nowYear
  // Latest streamed update for a key; earlier results stay visible while a
  // new run starts.
  const [latest, setLatest] = useState<{ key: string; update: RiskUpdate; running: boolean } | null>(null)
  const keyRef = useRef(key)

  useEffect(() => {
    keyRef.current = key
    if (cache.has(key)) return

    const timer = setTimeout(() => {
      const w = getWorker()
      if (!w) {
        let last: RiskUpdate | null = null
        void runRiskJob(activePlan, nowYear, update => { last = update }, { maxRuns: FALLBACK_RUNS }).then(() => {
          if (!last || keyRef.current !== key) return
          remember(key, last)
          setLatest({ key, update: last, running: false })
        })
        return
      }
      const id = nextId++
      const onMessage = (event: MessageEvent<RiskUpdate & { id: number }>) => {
        if (event.data.id !== id) return
        const { id: _ignored, ...update } = event.data
        void _ignored
        if (keyRef.current !== key) return
        if (update.done) {
          remember(key, update)
          w.removeEventListener('message', onMessage)
        }
        setLatest({ key, update, running: !update.done })
      }
      w.addEventListener('message', onMessage)
      w.postMessage({ id, plan: activePlan, startYear: nowYear })
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [key, activePlan, nowYear])

  const cached = cache.get(key)
  if (cached) return { ...cached, running: false }
  if (latest?.key === key) return { ...latest.update, running: latest.running }
  return { ...(latest?.update ?? {}), progress: 0, running: true }
}
