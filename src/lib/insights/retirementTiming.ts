import type { PlanV2 } from '@/lib/plan/schema'
import { applyChanges, createScorer, meetsTarget, type PlanScore } from './proposals'

// When to retire: a range of retirement ages, each tested the same way as a
// proposal. All of them are scored up front so that moving the slider on the
// page shows real results straight away.

const MAX_YEARS_EARLIER = 15
const MAX_YEARS_LATER = 10
// Past this, "keep working" stops being a realistic thing to suggest.
const LATEST_RETIREMENT_AGE = 75

export interface RetirementAgeOption {
  // Years from the plan's own retirement dates; negative is earlier.
  shift: number
  // Only the people still working: the others have nothing to choose.
  ages: { name: string; age: number }[]
  score: PlanScore
  safe: boolean
}

export interface RetirementTiming {
  // Earliest first. Always includes the plan's own age.
  options: RetirementAgeOption[]
  currentIndex: number
  // Null when no age tested is safe.
  safestIndex: number | null
  // Where the plan does best, for when no age is safe.
  bestIndex: number
  runs: number
}

export interface RetirementTimingUpdate {
  // Null until done, and when nobody in the plan is still working.
  timing: RetirementTiming | null
  progress: number // 0..1
  done: boolean
}

// Random markets can put one age just under the target while its neighbours
// pass, so this reads back from the latest age and stops at the first failure.
// The age it returns stays safe if retirement slips a year or two later.
function findSafestIndex(options: RetirementAgeOption[]): number | null {
  let found: number | null = null
  for (let i = options.length - 1; i >= 0; i--) {
    if (options[i].safe) found = i
    else if (found !== null) break
  }
  return found
}

function findBestIndex(options: RetirementAgeOption[]): number {
  const rank = (s: PlanScore) => [s.successRate ?? 0, s.goalProgressPct]
  return options.reduce((best, option, i) => {
    const [success, goal] = rank(option.score)
    const [bestSuccess, bestGoal] = rank(options[best].score)
    return success > bestSuccess || (success === bestSuccess && goal > bestGoal) ? i : best
  }, 0)
}

function shiftRange(working: PlanV2['people'], startYear: number): { earliest: number; latest: number } {
  // Below this everyone would already be retiring next year, so nothing changes.
  const allNextYear = Math.min(...working.map(p => startYear - p.birthYear + 1 - p.retirementAge))
  const latestAllowed = LATEST_RETIREMENT_AGE - Math.max(...working.map(p => p.retirementAge))
  return {
    earliest: Math.max(-MAX_YEARS_EARLIER, allNextYear),
    latest: Math.max(0, Math.min(MAX_YEARS_LATER, latestAllowed)),
  }
}

export async function runRetirementTimingJob(
  plan: PlanV2,
  startYear: number,
  onUpdate: (update: RetirementTimingUpdate) => void,
  opts: { maxRuns?: number; shouldStop?: () => boolean; yieldBetween?: () => Promise<void> } = {},
): Promise<void> {
  const working = plan.people.filter(p => startYear - p.birthYear < p.retirementAge)
  if (working.length === 0) {
    onUpdate({ timing: null, progress: 1, done: true })
    return
  }

  const { earliest, latest } = shiftRange(working, startYear)
  const workingIds = new Set(working.map(p => p.id))
  const candidates: { shift: number; plan: PlanV2; ages: RetirementAgeOption['ages'] }[] = []
  for (let shift = earliest; shift <= latest; shift++) {
    const candidate = shift === 0 ? plan : applyChanges(plan, [{ kind: 'retirementShift', years: shift }], startYear)
    const ages = candidate.people.filter(p => workingIds.has(p.id)).map(p => ({ name: p.name, age: p.retirementAge }))
    // Life expectancy can cap the later shifts, which would repeat an age.
    if (JSON.stringify(ages) !== JSON.stringify(candidates.at(-1)?.ages)) candidates.push({ shift, plan: candidate, ages })
  }

  const { score, runs } = createScorer(plan, startYear, opts.maxRuns)
  const options: RetirementAgeOption[] = []
  for (const candidate of candidates) {
    if (opts.shouldStop?.()) return
    const s = score(candidate.plan)
    options.push({ shift: candidate.shift, ages: candidate.ages, score: s, safe: meetsTarget(s, true) && s.funded })
    onUpdate({ timing: null, progress: Math.min(0.99, options.length / candidates.length), done: false })
    if (opts.yieldBetween) await opts.yieldBetween()
  }

  onUpdate({
    timing: {
      options,
      currentIndex: options.findIndex(o => o.shift === 0),
      safestIndex: findSafestIndex(options),
      bestIndex: findBestIndex(options),
      runs,
    },
    progress: 1,
    done: true,
  })
}
