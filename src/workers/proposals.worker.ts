/// <reference lib="webworker" />
import type { PlanV2 } from '@/lib/plan/schema'
import { runProposalJob } from '@/lib/insights/proposals'

self.onmessage = (event: MessageEvent<{ plan: PlanV2; startYear: number }>) => {
  const { plan, startYear } = event.data
  runProposalJob(plan, startYear, update => self.postMessage(update), {
    yieldBetween: () => new Promise(resolve => setTimeout(resolve, 0)),
  }).catch(() => {
    // A rejected promise doesn't reach the page's `error` listener.
    self.postMessage({ error: true })
  })
}
