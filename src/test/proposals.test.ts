import { describe, expect, it } from 'vitest'
import { planSchema, type PlanV2, type PlanV2Input } from '@/lib/plan/schema'
import { applyChanges, runProposalJob, type Change, type ProposalUpdate } from '@/lib/insights/proposals'
import { compilePlan, deterministicPath, simulate } from '@/lib/sim'
import { planGoalOutlook } from '@/lib/insights/outlook'

const YEAR = 2026
const person = (age: number, retirementAge: number, extra: object = {}) => ({
  id: 'a', name: 'A', birthYear: YEAR - age, retirementAge, province: 'ON' as const, cppStartAge: 65, ...extra,
})
const plan = (spend: number, o: Partial<PlanV2Input> = {}): PlanV2 => planSchema.parse({
  schemaVersion: 2, id: 'p', asOf: '2026-01-01',
  people: [person(50, 65)],
  accounts: [
    { id: 'r', ownerId: 'a', type: 'RRSP', balance: 700_000 },
    { id: 't', ownerId: 'a', type: 'TFSA', balance: 100_000 },
    { id: 'n', ownerId: 'a', type: 'NONREG', label: 'Brokerage', balance: 400_000, acb: 250_000 },
  ],
  incomes: [{
    id: 'i', ownerId: 'a', label: 'Salary', kind: 'employment', amount: 150_000, frequency: 'annual',
    to: { kind: 'retirement', personId: 'a', offset: 0 },
  }],
  expenses: {
    mode: 'detailed',
    items: [
      { id: 'e', label: 'Living', amount: spend, frequency: 'annual' },
      { id: 'o', label: 'Roof', amount: 20_000, frequency: 'oneTime' },
    ],
  },
  drawdown: { strategy: { kind: 'expenses' } },
  ...o,
})

async function job(p: PlanV2, maxRuns = 80) {
  let last: ProposalUpdate | undefined
  await runProposalJob(p, YEAR, update => { last = update }, { maxRuns })
  return last!
}

describe('applyChanges', () => {
  const apply = (p: PlanV2, ...changes: Change[]) => planSchema.parse(applyChanges(p, changes, YEAR))

  it('does not modify the original plan', () => {
    const p = plan(72_000)
    const snapshot = JSON.stringify(p)
    apply(p, { kind: 'spending', pct: -10 }, { kind: 'retirementShift', years: 2 })
    expect(JSON.stringify(p)).toBe(snapshot)
  })

  it('leaves one-time costs alone when spending changes', () => {
    const items = apply(plan(72_000), { kind: 'spending', pct: -10 }).expenses.items
    expect(items.find(i => i.id === 'e')!.amount).toBe(64_800)
    expect(items.find(i => i.id === 'o')!.amount).toBe(20_000)
  })

  it('keeps a benefit that has already started', () => {
    const p = plan(72_000, { people: [person(68, 60, { cppStartAge: 66, oas: { startAge: 67, yearsInCanadaAfter18: 40 } })] })
    const [after] = apply(p, { kind: 'benefitStart', cppAge: 70, oasAge: 70 }).people
    expect(after.cppStartAge).toBe(66)
    expect(after.oas.startAge).toBe(67)
  })

  it('moves benefit start ages that have not been reached', () => {
    const [after] = apply(plan(72_000), { kind: 'benefitStart', cppAge: 70, oasAge: 68 }).people
    expect(after.cppStartAge).toBe(70)
    expect(after.oas.startAge).toBe(68)
  })

  it('never moves retirement into the past', () => {
    const p = plan(72_000, { people: [person(64, 65)] })
    expect(apply(p, { kind: 'retirementShift', years: -5 }).people[0].retirementAge).toBe(65)
  })

  it('leaves someone already retired alone', () => {
    const p = plan(72_000, { people: [person(70, 65)] })
    expect(apply(p, { kind: 'retirementShift', years: 2 }).people[0].retirementAge).toBe(65)
  })

  it('adds savings as an indexed contribution', () => {
    const after = apply(plan(72_000), { kind: 'saving', annual: 5_000, accountId: 'n', accountLabel: 'Brokerage' })
    expect(after.accounts.find(a => a.id === 'n')!.contributions).toEqual([{ amount: 5_000, indexed: true }])
  })

  it('lowers the withdrawal rate with spending in simple mode', () => {
    const p = plan(0, { expenses: { mode: 'simple' }, drawdown: { strategy: { kind: 'initialPct', ratePct: 4 } } })
    const after = apply(p, { kind: 'spending', pct: -10 })
    expect(after.drawdown.strategy).toEqual({ kind: 'initialPct', ratePct: 3.6 })
    expect(after.expenses.replacementRate).toBeCloseTo(63, 6)
  })
})

// Each job runs many Monte Carlo simulations, which takes several times longer
// on CI runners than on a desktop.
describe('runProposalJob', { timeout: 120_000 }, () => {
  it('finishes with a score for the current plan', async () => {
    const update = await job(plan(72_000))
    expect(update.done).toBe(true)
    expect(update.progress).toBe(1)
    expect(update.tested).toBeGreaterThan(5)
    expect(update.base.successRate).not.toBeNull()
  })

  it('reports exactly what applying a proposal produces', async () => {
    const p = plan(100_000)
    const update = await job(p)
    expect(update.proposals.length).toBeGreaterThan(0)
    for (const proposal of update.proposals) {
      const applied = planSchema.parse(applyChanges(p, proposal.changes, YEAR))
      const again = await job(applied)
      expect(again.base.successRate).toBeCloseTo(proposal.score.successRate!, 10)
      expect(again.base.afterTaxEstate).toBeCloseTo(proposal.score.afterTaxEstate, 2)
    }
  })

  it('offers trade-offs when success is below target, stopping at the smallest that works', async () => {
    const update = await job(plan(100_000))
    expect(update.base.successRate!).toBeLessThan(0.9)
    const later = update.proposals.find(x => x.group === 'tradeoff' && x.changes[0].kind === 'retirementShift')!
    expect(later).toBeDefined()
    if (later.reachesTarget) {
      expect(later.score.successRate!).toBeGreaterThanOrEqual(0.9)
      const years = (later.changes[0] as { years: number }).years
      if (years > 1) {
        const one = await job(planSchema.parse(applyChanges(plan(100_000), [{ kind: 'retirementShift', years: years - 1 }], YEAR)))
        expect(one.base.successRate!).toBeLessThan(0.9)
      }
    }
    expect(update.proposals.some(x => x.group === 'spare')).toBe(false)
  })

  it('shows room to spare instead of trade-offs for a comfortable plan', async () => {
    const update = await job(plan(50_000))
    expect(update.base.successRate!).toBeGreaterThanOrEqual(0.9)
    expect(update.base.onTrack).toBe(true)
    const spare = update.proposals.filter(x => x.group === 'spare')
    expect(spare.length).toBeGreaterThan(0)
    for (const proposal of spare) expect(proposal.score.successRate!).toBeGreaterThanOrEqual(0.9)
    expect(update.proposals.some(x => x.group === 'tradeoff')).toBe(false)
  })

  it('only proposes free changes that beat the plan and do not cost success', async () => {
    const update = await job(plan(90_000))
    for (const proposal of update.proposals.filter(x => x.group === 'free' || x.group === 'combo')) {
      expect(proposal.score.successRate!).toBeGreaterThanOrEqual(update.base.successRate! - 0.0100001)
      const better = proposal.score.successRate! - update.base.successRate! >= 0.01
        || proposal.score.afterTaxEstate > update.base.afterTaxEstate
        || proposal.score.averageIncome > update.base.averageIncome
      expect(better).toBe(true)
    }
  })

  it('does not test withdrawal orders with only one kind of account', async () => {
    const p = plan(30_000, { accounts: [{ id: 'r', ownerId: 'a', type: 'RRSP', balance: 900_000 }] })
    const update = await job(p)
    expect(update.proposals.flatMap(x => x.changes).some(c => c.kind === 'withdrawalOrder')).toBe(false)
  })

  it('stops when a newer request replaces it', async () => {
    let updates = 0
    await runProposalJob(plan(72_000), YEAR, () => { updates++ }, { maxRuns: 10, shouldStop: () => updates > 1 })
    expect(updates).toBe(2)
  })
})

describe('planGoalOutlook', () => {
  it('agrees between dollar bases on whether the plan is on track', () => {
    const p = plan(72_000)
    const c = compilePlan(p, { startYear: YEAR })
    const result = simulate(c, deterministicPath(c.years, c.expectedReturnPct, c.inflationPct))
    const real = planGoalOutlook(p, c, result, YEAR, true).outlook
    const nominal = planGoalOutlook(p, c, result, YEAR, false).outlook
    expect(nominal.onTrack).toBe(real.onTrack)
    expect(nominal.progressPct).toBeCloseTo(real.progressPct, 6)
  })
})
