import { describe, it, expect } from 'vitest'
import { retirementOutlook, moneyLasts, retirementIncomeSources, retirementSpendingTarget } from '@/lib/insights/outlook'
import { calculateRetirementGoal, calculateRetirementGoalWithIncome } from '@/lib/calculations'
import type { PlanV2 } from '@/lib/plan/schema'
import { createDefaultPlan } from '@/lib/plan/defaults'
import { simulatePlan } from '@/lib/sim'
import type { RetirementGoalResult } from '@/lib/calculations'

function goal(overrides: Partial<RetirementGoalResult & { projectedAnnualIncome: number; afterTaxProjectedAnnualIncome: number }> = {}) {
  return {
    portfolioAtRetirement: 1_000_000, requiredAnnualIncome: 70_000, requiredAnnualIncomeAfterPension: 40_000,
    requiredPortfolio: 1_000_000, levelizedGuaranteedIncome: 30_000, giftTotal: 0, portfolioAfterGifts: 1_000_000,
    progress: 110, gap: 0, additionalAnnualSavings: 0,
    afterTaxPortfolioAtRetirement: 900_000, afterTaxPortfolioAfterGifts: 900_000,
    afterTaxProgress: 95, afterTaxGap: 50_000, afterTaxAdditionalAnnualSavings: 2_500,
    projectedAnnualIncome: 70_000, afterTaxProjectedAnnualIncome: 60_000,
    ...overrides,
  }
}

describe('retirementOutlook', () => {
  it('needs both pre-tax and after-tax progress when tax is known', () => {
    const o = retirementOutlook(goal(), { effectiveTaxRate: 15 })
    expect(o.onTrack).toBe(false)
    expect(o.progressPct).toBe(95)
    expect(o.progressBasis).toBe('afterTax')
    expect(o.extraSavingsNeeded).toBe(2_500)
    expect(o.afterTaxIncome).toBe(60_000)
  })

  it('uses pre-tax progress alone when there is no tax estimate', () => {
    const o = retirementOutlook(goal(), {})
    expect(o.onTrack).toBe(true)
    expect(o.progressPct).toBe(110)
    expect(o.progressBasis).toBe('preTax')
    expect(o.extraSavingsNeeded).toBe(0)
  })

  it('carries the levelized benefits through the tax snapshot', () => {
    const o = retirementOutlook(goal({ projectedAnnualIncome: 80_000 }), {
      effectiveTaxRate: 15,
      taxSummary: { preTaxIncome: 70_000, afterTaxIncome: 56_000, averageTaxRate: 20 } as never,
    })
    // 56,000 + (80,000 − 70,000) × 0.8
    expect(o.afterTaxIncome).toBe(64_000)
    expect(o.estimatedTax).toBe(16_000)
  })
})

describe('progress past the goal', () => {
  const goalFor = (total: number, annualPension: number, rrsp = 0) => calculateRetirementGoalWithIncome({
    currentProjectionData: [{ Total: total, RRSP: rrsp }] as never, annualSpendingTarget: 60_000, annualPension,
    withdrawalRate: 4, yearsToRetirement: 10, expectedReturn: 7, inflationRate: 2, currentAnnualContributions: 0, currentPortfolio: 0,
    effectiveTaxRate: rrsp > 0 ? 25 : 0,
  })

  it('reports income room rather than treating surplus savings as spending', () => {
    const o = retirementOutlook(goalFor(600_000, 40_000), {})
    expect(o.progressPct).toBeCloseTo(120, 6)
    expect(o.annualRoom).toBeCloseTo(4_000, 6)
  })

  it('keeps room proportionate when guaranteed income covers most of the goal', () => {
    const o = retirementOutlook(goalFor(500_000, 58_000), {})
    expect(o.progressPct).toBeCloseTo(1000, 6)
    expect(o.annualRoom).toBeCloseTo(18_000, 6)
  })

  it('measures room on the weaker after-tax basis when tax is known', () => {
    // RRSP tax leaves 500k of 600k: exactly the 500k needed, so no room.
    const o = retirementOutlook(goalFor(600_000, 40_000, 400_000), { effectiveTaxRate: 25 })
    expect(o.progressPct).toBeCloseTo(100, 6)
    expect(o.progressBasis).toBe('afterTax')
    expect(o.annualRoom).toBeCloseTo(0, 6)
  })

  it('counts surplus guaranteed income as room when no savings are needed', () => {
    const o = retirementOutlook(goalFor(100_000, 70_000), {})
    expect(o.noSavingsNeeded).toBe(true)
    expect(o.progressPct).toBe(100)
    // 4,000 from savings + 10,000 of guaranteed income above the goal.
    expect(o.annualRoom).toBeCloseTo(14_000, 6)
  })

  it('reports no room when the simulation runs short', () => {
    const o = retirementOutlook(goalFor(600_000, 40_000), { planFunded: false })
    expect(o.onTrack).toBe(false)
    expect(o.progressPct).toBeCloseTo(120, 6)
    expect(o.annualRoom).toBeNull()
    expect(o.metOnPaperOnly).toBe(true)
  })

  it('reports no room below the goal', () => {
    const o = retirementOutlook(goalFor(400_000, 40_000), {})
    expect(o.annualRoom).toBeNull()
    expect(o.metOnPaperOnly).toBe(false)
  })
})

describe('retirementIncomeSources', () => {
  const base = {
    portfolioAfterGifts: 1_000_000, withdrawalRatePct: 4, annualCpp: 15_000, annualOas: 9_000, annualPension: 0,
    showRealValues: true, inflationRatePct: 2, yearsToRetirement: 10,
  }

  it('lists withdrawals and guaranteed income, dropping empty sources', () => {
    expect(retirementIncomeSources(base)).toEqual([
      { key: 'withdrawals', amount: 40_000 },
      { key: 'cpp', amount: 15_000 },
      { key: 'oas', amount: 9_000 },
    ])
  })

  it('inflates guaranteed income to retirement-year dollars in future-dollar mode', () => {
    const [withdrawal, cpp] = retirementIncomeSources({ ...base, showRealValues: false })
    expect(withdrawal.amount).toBe(40_000)
    expect(cpp.amount).toBeCloseTo(15_000 * Math.pow(1.02, 10), 6)
  })
})

describe('retirementSpendingTarget', () => {
  const withSalary = (plan: PlanV2, amount: number): PlanV2 => ({
    ...plan,
    incomes: [{
      id: 'salary', ownerId: plan.people[0].id, label: 'Salary', kind: 'employment', amount, frequency: 'annual',
      to: { kind: 'retirement', personId: plan.people[0].id, offset: 0 },
      growth: { kind: 'cpi', pct: 0 }, taxTreatment: 'ordinary',
    }],
  })
  const simple = (salary: number): PlanV2 => {
    const plan = createDefaultPlan(new Date(2026, 0, 1))
    return withSalary({ ...plan, expenses: { ...plan.expenses, mode: 'simple', replacementRate: 50 } }, salary)
  }
  const detailed = (salary: number): PlanV2 => {
    const plan = createDefaultPlan(new Date(2026, 0, 1))
    return withSalary({
      ...plan,
      expenses: {
        ...plan.expenses,
        mode: 'detailed',
        replacementRate: 50,
        phases: [],
        items: [{ id: 'living', label: 'Living', category: 'living', amount: 89_000, frequency: 'annual', essential: true, indexed: true, realGrowthPct: 0 }],
      },
      properties: [{ id: 'home', ownerId: 'joint', label: 'Home', value: 1_000_000, appreciationRealPct: 0, isPrincipalResidence: true, annualCosts: 7_000 }],
    }, salary)
  }
  const target = (plan: PlanV2) => {
    const { compiled, result } = simulatePlan(plan, { startYear: 2026 })
    return retirementSpendingTarget(compiled, result)
  }

  it('is the budget plus home costs in detailed mode, whatever the salary', () => {
    expect(target(detailed(158_000))).toBeCloseTo(96_000, 6)
    expect(target(detailed(247_000))).toBeCloseTo(96_000, 6)
  })

  it('is the replacement share of salary in simple mode', () => {
    expect(target(simple(100_000))).toBeCloseTo(50_000, 6)
  })

  it('counts a goal that guaranteed income fully covers as met', () => {
    const goalResult = calculateRetirementGoal({
      currentProjectionData: [], annualSpendingTarget: 20_000, annualPension: 30_000, withdrawalRate: 4,
      yearsToRetirement: 10, expectedReturn: 7, inflationRate: 2, currentAnnualContributions: 0, currentPortfolio: 0,
    })
    expect(goalResult.requiredPortfolio).toBe(0)
    expect(goalResult.progress).toBe(100)
    expect(goalResult.afterTaxProgress).toBe(100)
  })
})

describe('moneyLasts', () => {
  it('reports the end of the plan when savings never run out', () => {
    const plan = createDefaultPlan(new Date(2026, 0, 1))
    const { compiled, result } = simulatePlan(plan, { startYear: 2026 })
    const lasts = moneyLasts(plan, compiled, result)
    if (result.depletionOffset === null) {
      expect(lasts.wholePlan).toBe(true)
      expect(lasts.year).toBe(2026 + compiled.years - 1)
    } else {
      expect(lasts.wholePlan).toBe(false)
    }
    expect(lasts.age).toBe(lasts.year - plan.people[0].birthYear)
  })
})
