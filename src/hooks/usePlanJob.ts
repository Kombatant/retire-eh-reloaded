import { useEffect, useState } from 'react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import type { PlanV2 } from '@/lib/plan/schema'
import { MODEL_VERSION } from '@/lib/sim/funding'

const DEBOUNCE_MS = 300
// Without a Worker (tests, very old browsers) run a small synchronous sample.
const FALLBACK_RUNS = 40
const CACHE_LIMIT = 8

export interface PlanJob<U, I = undefined> {
  createWorker: () => Worker
  runInline: (
    plan: PlanV2,
    startYear: number,
    onUpdate: (update: U) => void,
    opts: { maxRuns: number; shouldStop: () => boolean },
    input: I,
  ) => Promise<void>
  failedMessage: string
  cache: Map<string, U>
  cacheLimit?: number
}

export type PlanJobState<U> = Partial<U> & { running: boolean; error?: string }

function remember<U>(cache: Map<string, U>, key: string, value: U, limit: number) {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > limit) cache.delete(cache.keys().next().value as string)
}

// Runs a job on the active plan off the main thread. Each change of plan (or of
// the job's input) gets a fresh worker, so cancelling is terminating.
export function usePlanJob<U extends { done: boolean }, I = undefined>(job: PlanJob<U, I>, input?: I): PlanJobState<U> {
  const { activePlan, nowYear } = usePlanStore()
  const inputKey = JSON.stringify(input ?? null)
  const key = `${MODEL_VERSION}:${JSON.stringify(activePlan)}${nowYear}:${inputKey}`
  const [live, setLive] = useState<{ key: string; update?: U; error?: string } | null>(null)

  useEffect(() => {
    if (job.cache.has(key)) return
    let cancelled = false
    let worker: Worker | null = null
    const accept = (update: U) => {
      if (cancelled) return
      if (update.done) remember(job.cache, key, update, job.cacheLimit ?? CACHE_LIMIT)
      setLive({ key, update })
    }
    const fail = () => {
      if (!cancelled) setLive({ key, error: job.failedMessage })
    }
    // Rebuilt from the key, so a new object with the same content doesn't restart the job.
    const jobInput = JSON.parse(inputKey) as I
    const timer = setTimeout(() => {
      const runInline = () => job.runInline(activePlan, nowYear, accept, { maxRuns: FALLBACK_RUNS, shouldStop: () => cancelled }, jobInput).catch(fail)
      if (typeof Worker === 'undefined') {
        void runInline()
        return
      }
      // Some environments refuse a Worker outright, instead of failing later.
      try {
        worker = job.createWorker()
        worker.addEventListener('message', (event: MessageEvent<U | { error: true }>) => {
          if ('error' in event.data) fail()
          else accept(event.data)
        })
        worker.addEventListener('error', fail)
        worker.postMessage({ plan: activePlan, startYear: nowYear, input: jobInput })
      } catch {
        worker?.terminate()
        worker = null
        void runInline()
      }
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
      worker?.terminate()
    }
  }, [job, key, inputKey, activePlan, nowYear])

  const cached = job.cache.get(key)
  if (cached) return { ...cached, running: false }
  if (live?.key === key) return { ...live.update, running: !live.error, error: live.error } as PlanJobState<U>
  return { running: true } as PlanJobState<U>
}
