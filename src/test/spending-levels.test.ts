import { describe, it, expect } from 'vitest'
import { buildSpendingLevels } from '@/lib/insights/spendingLevels'
import { buildAccountBreakdown } from '@/lib/insights/accountBreakdown'
import { createDefaultPlan } from '@/lib/plan/defaults'
import type { PlanV2, SpendingStrategy } from '@/lib/plan/schema'
import { compilePlan, deterministicPath, simulate } from '@/lib/sim'
import { yearFellShort } from '@/lib/sim/failures'

const NOW = 2026
const RETURN = 5

function retiredPlan(budget: number, strategy: SpendingStrategy = { kind: 'expenses' }, balance = 1_500_000): PlanV2 {
  const base = createDefaultPlan(new Date(NOW, 0, 1))
  return {
    ...base,
    people: base.people.map(p => ({ ...p, birthYear: NOW - 65, retirementAge: 65, lifeExpectancy: 95 })),
    accounts: base.accounts.slice(0, 1).map(a => ({ ...a, balance, contributions: [] })),
    incomes: [],
    expenses: {
      ...base.expenses,
      mode: 'detailed',
      items: [{ id: 'budget', label: 'Budget', category: 'general', amount: budget, frequency: 'annual', essential: true, indexed: true, realGrowthPct: 0 }],
    },
    drawdown: { ...base.drawdown, strategy },
  }
}

const compile = (plan: PlanV2) => compilePlan(plan, { startYear: NOW })
const savingsOf = (plan: PlanV2, showReal = true) => {
  const c = compile(plan)
  const result = simulate(c, deterministicPath(c.years, RETURN, c.inflationPct))
  return buildAccountBreakdown(c, result, showReal).filter(r => r.phase === 'drawdown').map(r => r.balanceTotal)
}

describe('buildSpendingLevels', () => {
  const plan = retiredPlan(80_000)
  const result = buildSpendingLevels(compile(plan), RETURN, true)!

  it('tests amounts on both sides of the plan, a round step apart', () => {
    expect(result.levels.map(l => l.spending)).toEqual([60_000, 70_000, 80_000, 90_000, 100_000])
    expect(result.levels.filter(l => l.isPlan).map(l => l.spending)).toEqual([80_000])
  })

  it('shows the plan itself on the plan line', () => {
    const line = result.levels.find(l => l.isPlan)!
    savingsOf(plan).forEach((balance, i) => expect(line.balances[i]).toBeCloseTo(balance, 0))
  })

  it('matches changing the budget by the same amount', () => {
    const higher = result.levels.find(l => l.spending === 90_000)!
    // Within $5: the yearly withdrawal solver's rounding adds up over 30 years.
    savingsOf(retiredPlan(90_000)).forEach((balance, i) => expect(higher.balances[i]).toBeCloseTo(balance, -1))
  })

  it('leaves less the more is spent', () => {
    for (let l = 1; l < result.levels.length; l++) {
      const end = result.ages.length - 1
      expect(result.levels[l].balances[end]).toBeLessThanOrEqual(result.levels[l - 1].balances[end])
    }
  })

  it('says when higher spending runs out', () => {
    const tight = buildSpendingLevels(compile(retiredPlan(80_000, { kind: 'expenses' }, 900_000)), RETURN, true)!
    const top = tight.levels[tight.levels.length - 1]
    expect(top.runsOutAtAge).not.toBeNull()
    expect(top.balances[top.runsOutAtAge! - 65 + 1]).toBe(0)
  })

  it('finds the most that still pays for every year', () => {
    const c = compile(plan)
    const highest = result.highestSustainable!
    const path = deterministicPath(c.years, RETURN, c.inflationPct)
    const fellShort = (budget: number) => simulate(compile(retiredPlan(budget)), path).rows.some(yearFellShort)
    expect(fellShort(highest.spending)).toBe(false)
    expect(fellShort(highest.spending + 1_000)).toBe(true)
  })

  it('still responds to spending when the plan withdraws a fixed rate', () => {
    const fixed = buildSpendingLevels(compile(retiredPlan(80_000, { kind: 'initialPct', ratePct: 4 })), RETURN, true)!
    const end = fixed.ages.length - 1
    expect(fixed.levels[0].balances[end]).toBeGreaterThan(fixed.levels[4].balances[end])
  })

  it('uses the replacement target in simple mode', () => {
    const base = createDefaultPlan(new Date(NOW, 0, 1))
    const c = compile(base)
    const simple = buildSpendingLevels(c, RETURN, true)!
    expect(simple.levels.find(l => l.isPlan)!.spending).toBeCloseTo(c.simpleSpendingTarget, 6)
    const end = simple.ages.length - 1
    expect(simple.levels[0].balances[end]).toBeGreaterThan(simple.levels[4].balances[end])
  })

  it('follows the dollars switch', () => {
    const future = buildSpendingLevels(compile(plan), RETURN, false)!
    const line = future.levels.find(l => l.isPlan)!
    savingsOf(plan, false).forEach((balance, i) => expect(line.balances[i]).toBeCloseTo(balance, 0))
    expect(line.spending).toBe(80_000)
  })

  it('has nothing to compare without retirement spending', () => {
    expect(buildSpendingLevels(compile(retiredPlan(0)), RETURN, true)).toBeNull()
  })
})
