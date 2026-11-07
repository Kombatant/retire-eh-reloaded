import { describe, it, expect } from 'vitest'
import { estimateCppFromHistory } from '@/lib/benefits/cpp'
import { createDefaultPlan } from '@/lib/plan/defaults'
import { toLegacyPeople } from '@/lib/plan/legacy-view'
import { compilePlan } from '@/lib/sim'
import { TAX_2026 } from '@/lib/tax/data/2026'

const YMPE = TAX_2026.payroll.ympe
const base = { birthYear: 1961, retirementAge: 65, startedWorkingYear: 1983, typicalEarnings: YMPE, yearsNotWorking: 0, childRearingYears: 0 }

describe('CPP estimate from work history', () => {
  it('is close to the 2026 maximum for a full career at the YMPE', () => {
    const e = estimateCppFromHistory(base)
    expect(e.workingYears).toBe(43)
    expect(e.countedYears).toBe(39)
    expect(e.earningsRatio).toBe(1)
    // The published 2026 maximum at 65 is $18,092.
    expect(e.amountAt65 / 18092).toBeGreaterThan(0.97)
    expect(e.amountAt65 / 18092).toBeLessThan(1.04)
  })

  it('scales with earnings below the YMPE', () => {
    const full = estimateCppFromHistory(base)
    const half = estimateCppFromHistory({ ...base, typicalEarnings: YMPE / 2 })
    expect(half.base).toBeCloseTo(full.base / 2, 6)
    expect(half.amountAt65).toBeCloseTo(full.amountAt65 / 2, 6)
  })

  it('lowers the pension for a short Canadian career', () => {
    const late = estimateCppFromHistory({ ...base, startedWorkingYear: 2006 })
    expect(late.workingYears).toBe(20)
    expect(late.base).toBeCloseTo(estimateCppFromHistory(base).base * 20 / 39, 6)
  })

  it('treats years without earnings as gaps, but drops child-rearing years', () => {
    const gaps = estimateCppFromHistory({ ...base, startedWorkingYear: 1990, yearsNotWorking: 6 })
    const childRearing = estimateCppFromHistory({ ...base, startedWorkingYear: 1990, childRearingYears: 6 })
    expect(gaps.workingYears).toBe(childRearing.workingYears)
    // Fewer years in the period means fewer counted years, so a higher average.
    expect(childRearing.countedYears).toBeLessThan(gaps.countedYears)
    expect(childRearing.amountAt65).toBeGreaterThan(gaps.amountAt65)
  })

  it('credits earnings above the YMPE through the second enhancement', () => {
    const young = { ...base, birthYear: 1995, startedWorkingYear: 2018 }
    const atYmpe = estimateCppFromHistory({ ...young, typicalEarnings: YMPE })
    const high = estimateCppFromHistory({ ...young, typicalEarnings: 120000 })
    expect(atYmpe.secondEnhancement).toBe(0)
    expect(high.secondEnhancement).toBeGreaterThan(1000)
    // Earnings above the YAMPE add nothing more.
    expect(estimateCppFromHistory({ ...young, typicalEarnings: 300000 }).amountAt65).toBeCloseTo(high.amountAt65, 6)
  })

  it('stops accruing at an early retirement', () => {
    const early = estimateCppFromHistory({ ...base, retirementAge: 55 })
    expect(early.workingYears).toBe(33)
    expect(early.amountAt65).toBeLessThan(estimateCppFromHistory(base).amountAt65)
  })

  it('is the default for new people and uses their salary', () => {
    const now = new Date('2026-06-01')
    const plan = createDefaultPlan(now)
    expect(plan.people[0].cpp.mode).toBe('history')
    const legacy = toLegacyPeople(plan, 2026)[0]
    const expected = estimateCppFromHistory({
      birthYear: plan.people[0].birthYear, retirementAge: 65, startedWorkingYear: plan.people[0].birthYear + 22,
      typicalEarnings: 100000, yearsNotWorking: 0, childRearingYears: 0,
    }).amountAt65
    expect(legacy.annualCpp).toBeCloseTo(expected, 6)
    expect(compilePlan(plan, { startYear: 2026 }).people[0].cppAt65).toBeCloseTo(expected, 6)
  })
})
