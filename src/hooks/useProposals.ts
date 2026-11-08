import { runProposalJob, type ProposalUpdate } from '@/lib/insights/proposals'
import { usePlanJob, type PlanJob, type PlanJobState } from './usePlanJob'

const JOB: PlanJob<ProposalUpdate> = {
  createWorker: () => new Worker(new URL('../workers/proposals.worker.ts', import.meta.url), { type: 'module' }),
  runInline: runProposalJob,
  failedMessage: 'The proposals could not be calculated. Change the plan or reopen this page to try again.',
  cache: new Map(),
}

export type ProposalsState = PlanJobState<ProposalUpdate>

export function useProposals(): ProposalsState {
  return usePlanJob(JOB)
}
