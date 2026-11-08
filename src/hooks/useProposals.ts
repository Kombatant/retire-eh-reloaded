import { useEffect, useState } from 'react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { runProposalJob, type ProposalUpdate } from '@/lib/insights/proposals'

const DEBOUNCE_MS = 300
// Without a Worker (tests, very old browsers) run a small synchronous sample.
const FALLBACK_RUNS = 40
const CACHE_LIMIT = 8
const cache = new Map<string, ProposalUpdate>()

function remember(key: string, value: ProposalUpdate) {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
}

export interface ProposalsState extends Partial<ProposalUpdate> {
  running: boolean
  error?: string
}

const FAILED = 'The proposals could not be calculated. Change the plan or reopen this page to try again.'

// Tests changes to the active plan off the main thread. Only this page needs
// it, so each change of plan gets a fresh worker and cancelling is terminating.
export function useProposals(): ProposalsState {
  const { activePlan, nowYear } = usePlanStore()
  const key = JSON.stringify(activePlan) + nowYear
  const [live, setLive] = useState<{ key: string; update?: ProposalUpdate; error?: string } | null>(null)

  useEffect(() => {
    if (cache.has(key)) return
    let cancelled = false
    let worker: Worker | null = null
    const accept = (update: ProposalUpdate) => {
      if (cancelled) return
      if (update.done) remember(key, update)
      setLive({ key, update })
    }
    const fail = () => {
      if (!cancelled) setLive({ key, error: FAILED })
    }
    const timer = setTimeout(() => {
      if (typeof Worker === 'undefined') {
        runProposalJob(activePlan, nowYear, accept, { maxRuns: FALLBACK_RUNS, shouldStop: () => cancelled }).catch(fail)
        return
      }
      worker = new Worker(new URL('../workers/proposals.worker.ts', import.meta.url), { type: 'module' })
      worker.addEventListener('message', (event: MessageEvent<ProposalUpdate | { error: true }>) => {
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
  }, [key, activePlan, nowYear])

  const cached = cache.get(key)
  if (cached) return { ...cached, running: false }
  if (live?.key === key) return { ...(live.update ?? {}), running: !live.error, error: live.error }
  return { running: true }
}
