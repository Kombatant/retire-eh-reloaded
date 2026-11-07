import { describe, it, expect } from 'vitest'
import { PROVINCES } from '@/lib/plan/schema'
import { computeIncomeTax, emptyIncome, marginalTaxRate, ontarioHealthPremium } from '@/lib/tax/personal'
import { computeHouseholdTax, splittableAmount } from '@/lib/tax/household'
import { payrollContributions } from '@/lib/tax/payroll'
import { computePersonTax } from '@/lib/tax/quebecLegacy'
import { TAX_2026 } from '@/lib/tax/data/2026'
import { oasAnnualAmount } from '@/lib/benefits/oas'
import { gisAnnual } from '@/lib/benefits/gis'
import { estimateCppAt65, cppSurvivorBenefit } from '@/lib/benefits/cpp'
import type { ProvinceCode } from '@/lib/plan/schema'

const ordinary = (province: ProvinceCode, income: number, age = 40) =>
  computeIncomeTax({ ...emptyIncome(province, age), otherOrdinary: income })

describe('golden values (hand-computed from the 2026 CRA tables)', () => {
  // Federal at $60,000: 58,523 × 14% + 1,477 × 20.5% − 16,452 × 14% = 6,192.73
  it('federal tax at $60,000', () => {
    expect(ordinary('ON', 60000).federal).toBeCloseTo(6192.73, 1)
  })

  // ON: 53,891 × 5.05% + 6,109 × 9.15% − 12,989 × 5.05% = 2,624.52; no surtax;
  // health premium 600.
  it('Ontario at $60,000 includes the health premium', () => {
    const r = ordinary('ON', 60000)
    expect(r.provincial).toBeCloseTo(2624.52 + 600, 1)
    expect(r.total).toBeCloseTo(9417.25, 1)
  })

  // BC: 50,363 × 5.6% + 9,637 × 7.7% − 13,216 × 5.6% = 2,822.28; no low-income reduction.
  it('British Columbia at $60,000', () => {
    expect(ordinary('BC', 60000).provincial).toBeCloseTo(2822.28, 1)
  })

  // AB: 60,000 × 8% − 22,769 × 8% = 2,978.48
  it('Alberta at $60,000', () => {
    expect(ordinary('AB', 60000).provincial).toBeCloseTo(2978.48, 1)
  })

  // Federal BPA phases to 15,007.68 at $250,000; ON basic 24,168.05, surtax
  // 9,689.95, health premium 900.
  it('Ontario at $250,000 with surtax and the federal BPA phase-out', () => {
    const r = ordinary('ON', 250000)
    expect(r.federal).toBeCloseTo(54714.25, 0)
    expect(r.provincial).toBeCloseTo(34758.0, 0)
    // 29% federal + the BPA phase-out (0.295%) + 13.16% × 1.56 (surtax)
    expect(marginalTaxRate({ ...emptyIncome('ON', 40), otherOrdinary: 250000 })).toBeCloseTo(49.82, 1)
  })

  it('applies the BC low-income tax reduction', () => {
    const r = ordinary('BC', 25000)
    // 25,000 × 5.6% − 13,216 × 5.6% = 659.90, less the full $575 reduction.
    expect(r.provincial).toBeCloseTo(84.9, 1)
  })

  it('computes the Ontario Health Premium bands', () => {
    expect(ontarioHealthPremium(20000)).toBe(0)
    expect(ontarioHealthPremium(30000)).toBeCloseTo(300, 5)
    expect(ontarioHealthPremium(40000)).toBeCloseTo(450, 5)
    expect(ontarioHealthPremium(100000)).toBeCloseTo(750, 5)
    expect(ontarioHealthPremium(300000)).toBeCloseTo(900, 5)
  })
})

describe('every jurisdiction', () => {
  for (const province of PROVINCES) {
    it(`${province}: tax rises with income and stays within plausible rates`, () => {
      const incomes = [30000, 60000, 120000, 250000]
      const totals = incomes.map(i => ordinary(province, i).total)
      for (let i = 1; i < totals.length; i++) expect(totals[i]).toBeGreaterThan(totals[i - 1])
      incomes.forEach((income, i) => {
        const average = totals[i] / income
        expect(average).toBeGreaterThan(0.03)
        expect(average).toBeLessThan(0.45)
      })
      const top = marginalTaxRate({ ...emptyIncome(province, 40), otherOrdinary: 1500000 })
      expect(top).toBeGreaterThan(44)
      expect(top).toBeLessThan(55)
    })
  }

  it('gives seniors lower tax through age and pension credits', () => {
    for (const province of PROVINCES) {
      const young = computeIncomeTax({ ...emptyIncome(province, 60), pension: 40000 })
      const senior = computeIncomeTax({ ...emptyIncome(province, 66), pension: 40000 })
      expect(senior.total).toBeLessThan(young.total)
    }
  })

  it('applies bracket creep when a province does not index (PEI)', () => {
    const indexed = computeIncomeTax({ ...emptyIncome('PE', 40), otherOrdinary: 80000 }, { deflator: 1 })
    const frozen = computeIncomeTax({ ...emptyIncome('PE', 40), otherOrdinary: 80000 }, { deflator: 0.7 })
    expect(frozen.provincial).toBeGreaterThan(indexed.provincial)
    const on = computeIncomeTax({ ...emptyIncome('ON', 40), otherOrdinary: 80000 }, { deflator: 0.7 })
    expect(on.provincial).toBeCloseTo(ordinary('ON', 80000).provincial, 6)
  })
})

describe('Quebec matches the original estimator', () => {
  const cases = [
    { income: 30000, pension: 10000, oas: 9024, age: 66 },
    { income: 60000, pension: 20000, oas: 9024, age: 70 },
    { income: 110000, pension: 0, oas: 9024, age: 68 },
    { income: 150000, pension: 50000, oas: 9024, age: 72 },
    { income: 70000, pension: 0, oas: 0, age: 60 },
  ]
  for (const c of cases) {
    it(`at $${c.income} (age ${c.age})`, () => {
      const legacy = computePersonTax({ taxableIncome: c.income, age: c.age, oasReceived: c.oas, eligiblePensionIncome: c.pension })
      const next = computeIncomeTax({
        ...emptyIncome('QC', c.age), pension: c.pension, oas: c.oas, otherOrdinary: c.income - c.pension - c.oas,
      })
      expect(next.federal).toBeCloseTo(legacy.federal, 2)
      expect(next.provincial).toBeCloseTo(legacy.quebec, 2)
      expect(next.oasClawback).toBeCloseTo(legacy.oasClawback, 2)
    })
  }
})

describe('payroll contributions', () => {
  it('reaches the 2026 CRA maximums at high employment income', () => {
    const on = payrollContributions(150000, 'ON', TAX_2026)
    expect(on.pensionBase).toBeCloseTo(3519.45, 2)
    expect(on.pensionEnhanced).toBeCloseTo(711 + 416, 2)
    expect(on.ei).toBeCloseTo(1123.07, 2)
    expect(on.qpip).toBe(0)

    const qc = payrollContributions(150000, 'QC', TAX_2026)
    expect(qc.pensionBase).toBeCloseTo(3768.3, 2)
    expect(qc.ei).toBeCloseTo(895.7, 2)
    expect(qc.qpip).toBeCloseTo(442.9, 2)
  })

  it('deducts enhanced contributions and credits base contributions', () => {
    const employed = computeIncomeTax({ ...emptyIncome('ON', 40), employment: 100000 })
    const other = ordinary('ON', 100000)
    expect(employed.netIncome).toBeCloseTo(100000 - employed.payroll.pensionEnhanced, 2)
    expect(employed.total).toBeLessThan(other.total)
  })
})

describe('pension income splitting', () => {
  const base = (province: ProvinceCode, age: number, pension: number) => ({ ...emptyIncome(province, age), pension })

  it('moves eligible pension income to the lower-income spouse', () => {
    const members = [base('ON', 67, 100000), base('ON', 67, 0)]
    const without = computeHouseholdTax(members, { splitting: false })
    const withSplit = computeHouseholdTax(members, { splitting: true })
    expect(withSplit.total).toBeLessThan(without.total - 3000)
    expect(withSplit.splits[0]).toBeLessThan(0)
    expect(withSplit.splits[0] + withSplit.splits[1]).toBeCloseTo(0, 6)
    expect(-withSplit.splits[0]).toBeLessThanOrEqual(50000 + 1e-6)
  })

  it('only splits RRIF withdrawals from age 65', () => {
    expect(splittableAmount({ ...emptyIncome('ON', 60), registeredWithdrawals: 40000 })).toBe(0)
    expect(splittableAmount({ ...emptyIncome('ON', 65), registeredWithdrawals: 40000 })).toBe(20000)
    expect(splittableAmount({ ...emptyIncome('ON', 60), pension: 40000 })).toBe(20000)
  })

  it('requires the transferor to be 65+ in Quebec', () => {
    expect(splittableAmount({ ...emptyIncome('QC', 60), pension: 40000 })).toBe(0)
    expect(splittableAmount({ ...emptyIncome('QC', 65), pension: 40000 })).toBe(20000)
  })
})

describe('government benefits', () => {
  it('prorates OAS by residency and adds 10% at 75', () => {
    expect(oasAnnualAmount({ age: 70, startAge: 65, yearsInCanadaAfter18: 40 })).toBeCloseTo(9024, 2)
    expect(oasAnnualAmount({ age: 70, startAge: 65, yearsInCanadaAfter18: 20 })).toBeCloseTo(4512, 2)
    expect(oasAnnualAmount({ age: 70, startAge: 65, yearsInCanadaAfter18: 9 })).toBe(0)
    expect(oasAnnualAmount({ age: 75, startAge: 65, yearsInCanadaAfter18: 40 })).toBeCloseTo(9024 * 1.1, 2)
    expect(oasAnnualAmount({ age: 64, startAge: 65, yearsInCanadaAfter18: 40 })).toBe(0)
  })

  it('pays the maximum GIS with no other income and none at the cutoff', () => {
    const [full] = gisAnnual([{ receivesOas: true, otherIncome: 0, employmentIncome: 0 }])
    expect(full).toBeCloseTo(TAX_2026.gis.single.maxAnnual, 2)
    const [none] = gisAnnual([{ receivesOas: true, otherIncome: 23112, employmentIncome: 0 }])
    expect(none).toBe(0)
    const [notEligible] = gisAnnual([{ receivesOas: false, otherIncome: 0, employmentIncome: 0 }])
    expect(notEligible).toBe(0)
  })

  it('uses combined income for couples and exempts some employment income', () => {
    const couple = gisAnnual([
      { receivesOas: true, otherIncome: 10000, employmentIncome: 0 },
      { receivesOas: true, otherIncome: 5000, employmentIncome: 0 },
    ])
    expect(couple[0]).toBeCloseTo(couple[1], 6)
    expect(couple[0]).toBeGreaterThan(0)
    const [working] = gisAnnual([{ receivesOas: true, otherIncome: 0, employmentIncome: 5000 }])
    expect(working).toBeCloseTo(TAX_2026.gis.single.maxAnnual, 2)
  })

  it('estimates CPP near the 2026 maximum for a full career at the YMPE', () => {
    const cpp = estimateCppAt65({ averageEarningsRatioPct: 100, contributoryYears: 39, birthYear: 1961, retirementAge: 65 })
    expect(cpp / 18092).toBeGreaterThan(0.97)
    expect(cpp / 18092).toBeLessThan(1.05)
    const half = estimateCppAt65({ averageEarningsRatioPct: 50, contributoryYears: 39, birthYear: 1961, retirementAge: 65 })
    expect(half).toBeCloseTo(cpp / 2, 6)
    // Younger workers accrue more of the enhancement.
    const young = estimateCppAt65({ averageEarningsRatioPct: 100, contributoryYears: 39, birthYear: 2000, retirementAge: 65 })
    expect(young).toBeGreaterThan(cpp)
  })

  it('caps the CPP survivor pension at the maximum retirement pension', () => {
    expect(cppSurvivorBenefit({ deceasedPension: 15000, survivorOwnPension: 0, survivorAge: 70, maxRetirementPension: 18092 })).toBeCloseTo(9000, 6)
    expect(cppSurvivorBenefit({ deceasedPension: 15000, survivorOwnPension: 15000, survivorAge: 70, maxRetirementPension: 18092 })).toBeCloseTo(3092, 6)
    expect(cppSurvivorBenefit({ deceasedPension: 15000, survivorOwnPension: 0, survivorAge: 60, maxRetirementPension: 18092 })).toBeCloseTo(5625, 6)
  })
})
