/// <reference lib="webworker" />
import type { PlanV2 } from '@/lib/plan/schema'
import { runRetirementTimingJob } from '@/lib/insights/retirementTiming'

self.onmessage = (event: MessageEvent<{ plan: PlanV2; startYear: number }>) => {
  const { plan, startYear } = event.data
  runRetirementTimingJob(plan, startYear, update => self.postMessage(update), {
    yieldBetween: () => new Promise(resolve => setTimeout(resolve, 0)),
  }).catch(() => {
    // A rejected promise doesn't reach the page's `error` listener.
    self.postMessage({ error: true })
  })
}
