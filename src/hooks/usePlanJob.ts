import { useEffect, useState } from 'react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import type { PlanV2 } from '@/lib/plan/schema'

const DEBOUNCE_MS = 300
// Without a Worker (tests, very old browsers) run a small synchronous sample.
const FALLBACK_RUNS = 40
const CACHE_LIMIT = 8

export interface PlanJob<U> {
  createWorker: () => Worker
  runInline: (
    plan: PlanV2,
    startYear: number,
    onUpdate: (update: U) => void,
    opts: { maxRuns: number; shouldStop: () => boolean },
  ) => Promise<void>
  failedMessage: string
  cache: Map<string, U>
}

export type PlanJobState<U> = Partial<U> & { running: boolean; error?: string }

function remember<U>(cache: Map<string, U>, key: string, value: U) {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
}

// Runs a job on the active plan off the main thread. Each change of plan gets a
// fresh worker, so cancelling is terminating.
export function usePlanJob<U extends { done: boolean }>(job: PlanJob<U>): PlanJobState<U> {
  const { activePlan, nowYear } = usePlanStore()
  const key = JSON.stringify(activePlan) + nowYear
  const [live, setLive] = useState<{ key: string; update?: U; error?: string } | null>(null)

  useEffect(() => {
    if (job.cache.has(key)) return
    let cancelled = false
    let worker: Worker | null = null
    const accept = (update: U) => {
      if (cancelled) return
      if (update.done) remember(job.cache, key, update)
      setLive({ key, update })
    }
    const fail = () => {
      if (!cancelled) setLive({ key, error: job.failedMessage })
    }
    const timer = setTimeout(() => {
      if (typeof Worker === 'undefined') {
        job.runInline(activePlan, nowYear, accept, { maxRuns: FALLBACK_RUNS, shouldStop: () => cancelled }).catch(fail)
        return
      }
      worker = job.createWorker()
      worker.addEventListener('message', (event: MessageEvent<U | { error: true }>) => {
        if ('error' in event.data) fail()
        else accept(event.data)
      })
      worker.addEventListener('error', fail)
      worker.postMessage({ plan: activePlan, startYear: nowYear })
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
      worker?.terminate()
    }
  }, [job, key, activePlan, nowYear])

  const cached = job.cache.get(key)
  if (cached) return { ...cached, running: false }
  if (live?.key === key) return { ...live.update, running: !live.error, error: live.error } as PlanJobState<U>
  return { running: true } as PlanJobState<U>
}
