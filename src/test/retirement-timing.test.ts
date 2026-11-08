import { describe, expect, it } from 'vitest'
import { planSchema, type PlanV2, type PlanV2Input } from '@/lib/plan/schema'
import { applyChanges, runProposalJob, type ProposalUpdate } from '@/lib/insights/proposals'
import { runRetirementTimingJob, type RetirementTiming, type RetirementTimingUpdate } from '@/lib/insights/retirementTiming'

const YEAR = 2026
const person = (id: string, age: number, retirementAge: number, extra: object = {}) => ({
  id, name: id.toUpperCase(), birthYear: YEAR - age, retirementAge, province: 'ON' as const, cppStartAge: 65, ...extra,
})
const plan = (spend: number, o: Partial<PlanV2Input> = {}): PlanV2 => planSchema.parse({
  schemaVersion: 2, id: 'p', asOf: '2026-01-01',
  people: [person('a', 50, 65)],
  accounts: [
    { id: 'r', ownerId: 'a', type: 'RRSP', balance: 700_000 },
    { id: 't', ownerId: 'a', type: 'TFSA', balance: 100_000 },
    { id: 'n', ownerId: 'a', type: 'NONREG', label: 'Brokerage', balance: 400_000, acb: 250_000 },
  ],
  incomes: [{
    id: 'i', ownerId: 'a', label: 'Salary', kind: 'employment', amount: 150_000, frequency: 'annual',
    to: { kind: 'retirement', personId: 'a', offset: 0 },
  }],
  expenses: { mode: 'detailed', items: [{ id: 'e', label: 'Living', amount: spend, frequency: 'annual' }] },
  drawdown: { strategy: { kind: 'expenses' } },
  ...o,
})

async function job(p: PlanV2, maxRuns = 40): Promise<RetirementTiming | null> {
  let last: RetirementTimingUpdate | undefined
  await runRetirementTimingJob(p, YEAR, update => { last = update }, { maxRuns })
  expect(last!.done).toBe(true)
  return last!.timing
}

describe('runRetirementTimingJob', { timeout: 120_000 }, () => {
  it('has nothing to choose when everyone is retired', async () => {
    expect(await job(plan(50_000, { people: [person('a', 70, 65)] }))).toBeNull()
  })

  it('finds an age before the plan when the plan has room', async () => {
    const timing = (await job(plan(50_000)))!
    expect(timing.safestIndex).not.toBeNull()
    expect(timing.options[timing.safestIndex!].shift).toBeLessThan(0)
  })

  it('finds an age after the plan when the plan falls short', async () => {
    const timing = (await job(plan(100_000)))!
    expect(timing.options[timing.currentIndex].safe).toBe(false)
    expect(timing.safestIndex).not.toBeNull()
    expect(timing.options[timing.safestIndex!].shift).toBeGreaterThan(0)
  })

  it('reports an age that stays safe at every later age', async () => {
    const timing = (await job(plan(50_000)))!
    const i = timing.safestIndex!
    expect(timing.options.slice(i).every(o => o.safe)).toBe(true)
    if (i > 0) expect(timing.options[i - 1].safe).toBe(false)
  })

  it('reports no safe age when even the latest falls short, and still names the best', async () => {
    const timing = (await job(plan(400_000)))!
    expect(timing.safestIndex).toBeNull()
    const best = timing.options[timing.bestIndex].score.successRate!
    for (const o of timing.options) expect(o.score.successRate!).toBeLessThanOrEqual(best)
  })

  it('never tests retiring before next year or after 75', async () => {
    const soon = (await job(plan(50_000, { people: [person('a', 64, 65)] })))!
    expect(soon.options[0].ages[0].age).toBe(65)
    const late = (await job(plan(50_000, { people: [person('a', 50, 70)] })))!
    expect(late.options.at(-1)!.ages[0].age).toBe(75)
  })

  it('tests the plan’s own age with the same score the proposals give it', async () => {
    const p = plan(72_000)
    const timing = (await job(p))!
    let proposals: ProposalUpdate | undefined
    await runProposalJob(p, YEAR, update => { proposals = update }, { maxRuns: 40, shouldStop: () => proposals !== undefined })
    expect(timing.options[timing.currentIndex].shift).toBe(0)
    expect(timing.options[timing.currentIndex].score).toEqual(proposals!.base)
  })

  it('shows exactly what applying that age produces', async () => {
    const p = plan(72_000)
    const timing = (await job(p))!
    const option = timing.options[timing.currentIndex + 2]
    const applied = planSchema.parse(applyChanges(p, [{ kind: 'retirementShift', years: option.shift }], YEAR))
    const again = (await job(applied))!
    expect(again.options[again.currentIndex].score).toEqual(option.score)
  })

  it('lists only the people still working, moving them together', async () => {
    const p = plan(60_000, { people: [person('a', 50, 65), person('b', 48, 62), person('c', 70, 65)] })
    const timing = (await job(p))!
    const later = timing.options[timing.currentIndex + 1]
    expect(later.ages).toEqual([{ name: 'A', age: 66 }, { name: 'B', age: 63 }])
  })

  it('stops when a newer request replaces it', async () => {
    let updates = 0
    await runRetirementTimingJob(plan(72_000), YEAR, () => { updates++ }, { maxRuns: 10, shouldStop: () => updates > 1 })
    expect(updates).toBe(2)
  })
})
