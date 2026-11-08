import { describe, it, expect } from 'vitest'
import { retirementOutlook, moneyLasts, retirementIncomeSources } from '@/lib/insights/outlook'
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
