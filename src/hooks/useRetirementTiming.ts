import { runRetirementTimingJob, type RetirementTimingUpdate } from '@/lib/insights/retirementTiming'
import { usePlanJob, type PlanJob, type PlanJobState } from './usePlanJob'

const JOB: PlanJob<RetirementTimingUpdate> = {
  createWorker: () => new Worker(new URL('../workers/retirementTiming.worker.ts', import.meta.url), { type: 'module' }),
  runInline: runRetirementTimingJob,
  failedMessage: 'Retirement ages could not be tested. Change the plan or reopen this page to try again.',
  cache: new Map(),
}

export function useRetirementTiming(): PlanJobState<RetirementTimingUpdate> {
  return usePlanJob(JOB)
}
