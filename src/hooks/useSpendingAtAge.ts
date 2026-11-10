import { runSpendingAtAgeJob, type SpendingAtAgeUpdate } from '@/lib/insights/retirementTiming'
import { usePlanJob, type PlanJob, type PlanJobState } from './usePlanJob'

const JOB: PlanJob<SpendingAtAgeUpdate, { shift: number }> = {
  createWorker: () => new Worker(new URL('../workers/spendingAtAge.worker.ts', import.meta.url), { type: 'module' }),
  runInline: runSpendingAtAgeJob,
  failedMessage: 'Spending levels could not be tested. Change the plan or reopen this page to try again.',
  cache: new Map(),
  // One entry per retirement age visited, so going back to one is instant.
  cacheLimit: 32,
}

// Spending levels at the retirement age `shift` years from the plan's own.
export function useSpendingAtAge(shift: number): PlanJobState<SpendingAtAgeUpdate> {
  return usePlanJob(JOB, { shift })
}
