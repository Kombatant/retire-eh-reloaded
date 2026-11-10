import type { PlanV2 } from '@/lib/plan/schema'
import { applyChanges, createScorer, meetsTarget, type Change, type PlanScore } from './proposals'

// When to retire: a range of retirement ages, each tested the same way as a
// proposal. All of them are scored up front so that moving the slider on the
// page shows real results straight away.

const MAX_YEARS_EARLIER = 15
const MAX_YEARS_LATER = 10
// Past this, "keep working" stops being a realistic thing to suggest.
const LATEST_RETIREMENT_AGE = 75
// Changes to recurring spending tried at one retirement age, lowest first.
export const SPENDING_STEPS_PCT = [-30, -25, -20, -15, -10, -5, 0, 5, 10, 15, 20, 25, 30]

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

export interface SpendingOption {
  pct: number
  score: PlanScore
  safe: boolean
}

export interface SpendingAtAge {
  shift: number
  // Lined up with SPENDING_STEPS_PCT; null until that level is tested.
  options: (SpendingOption | null)[]
  // The most spending that is safe with every lower level safe too. Null until
  // done, and when even the lowest level falls short.
  highestSafeIndex: number | null
  runs: number
}

export interface SpendingAtAgeUpdate {
  result: SpendingAtAge
  progress: number // 0..1
  done: boolean
}

const isSafe = (s: PlanScore) => meetsTarget(s, true) && s.funded

// The changes behind one point of the page's two sliders, so what is tested is
// exactly what gets applied.
export function timingChanges(shift: number, spendingPct: number): Change[] {
  const changes: Change[] = []
  if (shift !== 0) changes.push({ kind: 'retirementShift', years: shift })
  if (spendingPct !== 0) changes.push({ kind: 'spending', pct: spendingPct })
  return changes
}

// The earliest age from which every later age tested is also safe, so the
// answer holds if retirement slips later. If the latest age fails, none qualify:
// reading back stops at the first failure and never skips one.
export function findSafestIndex(options: Pick<RetirementAgeOption, 'safe'>[]): number | null {
  let found: number | null = null
  for (let i = options.length - 1; i >= 0 && options[i].safe; i--) found = i
  return found
}

// Mirrors findSafestIndex: reading up from the lowest spending, stop at the
// first level that falls short.
export function findHighestSafeIndex(options: (Pick<SpendingOption, 'safe'> | null)[]): number | null {
  let found: number | null = null
  for (let i = 0; i < options.length && options[i]?.safe; i++) found = i
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
    options.push({ shift: candidate.shift, ages: candidate.ages, score: s, safe: isSafe(s) })
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

// Spending levels at one retirement age (`shift` years from the plan). Too many
// to score for every age up front, so the page asks for the age on screen.
// Levels nearest the plan's spending go first, since they are the likeliest to
// be looked at.
export async function runSpendingAtAgeJob(
  plan: PlanV2,
  startYear: number,
  onUpdate: (update: SpendingAtAgeUpdate) => void,
  opts: { maxRuns?: number; shouldStop?: () => boolean; yieldBetween?: () => Promise<void> } = {},
  input: { shift: number } = { shift: 0 },
): Promise<void> {
  const { score, runs } = createScorer(plan, startYear, opts.maxRuns)
  const options: SpendingAtAge['options'] = SPENDING_STEPS_PCT.map(() => null)
  const order = SPENDING_STEPS_PCT.map((pct, i) => ({ pct, i })).sort((a, b) => Math.abs(a.pct) - Math.abs(b.pct) || a.pct - b.pct)
  let tested = 0
  for (const { pct, i } of order) {
    if (opts.shouldStop?.()) return
    const s = score(applyChanges(plan, timingChanges(input.shift, pct), startYear))
    options[i] = { pct, score: s, safe: isSafe(s) }
    tested++
    const done = tested === order.length
    onUpdate({
      result: { shift: input.shift, options: [...options], highestSafeIndex: done ? findHighestSafeIndex(options) : null, runs },
      progress: tested / order.length,
      done,
    })
    if (!done && opts.yieldBetween) await opts.yieldBetween()
  }
}
