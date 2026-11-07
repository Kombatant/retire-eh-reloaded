/// <reference lib="webworker" />
import type { PlanV2 } from '@/lib/plan/schema'
import { runRiskJob } from '@/lib/sim/riskJob'

interface RiskRequest {
  id: number
  plan: PlanV2
  startYear: number
}

// Only the newest request matters; older ones stop at their next batch.
let latest = 0

self.onmessage = (event: MessageEvent<RiskRequest>) => {
  const { id, plan, startYear } = event.data
  latest = id
  void runRiskJob(plan, startYear, update => self.postMessage({ id, ...update }), {
    shouldStop: () => latest !== id,
    // Yield so a newer request can arrive between batches.
    yieldBetweenBatches: () => new Promise(resolve => setTimeout(resolve, 0)),
  })
}
