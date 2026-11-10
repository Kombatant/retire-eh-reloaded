/// <reference lib="webworker" />
import type { PlanV2 } from '@/lib/plan/schema'
import { runSpendingAtAgeJob } from '@/lib/insights/retirementTiming'

self.onmessage = (event: MessageEvent<{ plan: PlanV2; startYear: number; input: { shift: number } }>) => {
  const { plan, startYear, input } = event.data
  runSpendingAtAgeJob(plan, startYear, update => self.postMessage(update), {
    yieldBetween: () => new Promise(resolve => setTimeout(resolve, 0)),
  }, input).catch(() => {
    // A rejected promise doesn't reach the page's `error` listener.
    self.postMessage({ error: true })
  })
}
