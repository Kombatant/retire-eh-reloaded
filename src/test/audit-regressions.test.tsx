import { describe, expect, it } from 'vitest'
import { planSchema, type PlanV2, type PlanV2Input, type ProvinceCode } from '@/lib/plan/schema'
import { compilePlan, cumulativeCpi, deterministicPath, planPath, shiftedDeterministicPath, simulate } from '@/lib/sim'
import { firstPeriodFraction } from '@/lib/sim/compile'
import { lognormalReturn } from '@/lib/sim/paths/monteCarlo'
import { historicalPath, retirementAnchoredPath } from '@/lib/sim/paths/historical'
import { baselineFromPlan, baselineValueAt } from '@/lib/insights/tracking'
import { buildYearTable } from '@/lib/insights/yearTable'
import { evaluateFunding } from '@/lib/sim/funding'
import { buildRetirementTaxSnapshot } from '@/lib/sim/taxSnapshot'
import { planGoalOutlook, moneyLasts, retirementSpendingTarget } from '@/lib/insights/outlook'
import { findSafestIndex } from '@/lib/insights/retirementTiming'
import { isImprovement, type PlanScore } from '@/lib/insights/proposals'
import { planMetrics } from '@/lib/insights/compare'
import { buildSpendingLevels } from '@/lib/insights/spendingLevels'
import { buildContributionGrowth } from '@/lib/contributionGrowth'
import { runCrashScenarios, runSucceeded, successIsMeaningful, successRange } from '@/lib/sim/risk'
import { computeHouseholdTax } from '@/lib/tax/household'
import { computeIncomeTax, emptyIncome } from '@/lib/tax/personal'
import { payrollContributions } from '@/lib/tax/payroll'
import { TAX_2026 } from '@/lib/tax/data/2026'
import { addAccount, deletePerson, patchAccountBalance } from '@/lib/plan/edits'
import { advancedSettingsInUse } from '@/lib/plan/advanced'
import { createDefaultPlan, isoDate } from '@/lib/plan/defaults'
import { diagnosePlan, isRealDate } from '@/lib/plan/diagnostics'
import { withContributionsStoppingIn } from '@/lib/insights/fi'
import { buildSankeyData } from '@/lib/insights/sankey'
import { buildMilestones } from '@/lib/insights/milestones'
import { bracketPosition } from '@/lib/insights/brackets'
import { getCppIncomeAtAge } from '@/lib/calculations'
import { gisAnnual } from '@/lib/benefits/gis'
import { cppSurvivorBenefit, estimateCppFromHistory } from '@/lib/benefits/cpp'
import { deflateSync, strToU8 } from 'fflate'
import { decodePlan, encodePlan } from '@/lib/share-link'
import { importFromYAML } from '@/lib/yaml-utils'
import { toCsv } from '@/lib/insights/csv'
import { QUOTE_PROVIDERS } from '@/lib/market/quotes'
import { amortizeYear } from '@/lib/sim/steps/debts'
import { lifMaximumFactor } from '@/lib/sim/steps/rrif'
import { provinceRealValues } from '@/lib/tax/indexation'
import { yearFellShort } from '@/lib/sim/failures'
import { loadStoreWithRecovery, preserveRecovery, readRecoveryEntries, serializeStore, STORE_KEY, RECOVERY_KEY } from '@/lib/plan/storage'

// Each case here is a scenario where the engine used to give a wrong answer.
const YEAR = 2026
const NOW = new Date('2026-06-01')
const plan = (o: Partial<PlanV2Input> & Pick<PlanV2Input, 'people'>): PlanV2 =>
  planSchema.parse({ schemaVersion: 2, id: 'p', asOf: '2026-01-01', ...o })
const person = (age: number, retirementAge: number, extra: object = {}) => ({
  id: 'a', name: 'A', birthYear: YEAR - age, retirementAge, province: 'ON' as const,
  cpp: { mode: 'amount' as const, amountAt65: 0 }, oas: { startAge: 65, yearsInCanadaAfter18: 0 }, ...extra,
})
const spouse = (age: number, retirementAge: number, extra: object = {}) => person(age, retirementAge, { id: 'b', name: 'B', ...extra })
const run = (p: PlanV2, returnPct = 0, inflationPct = 0) => {
  const c = compilePlan(p, { startYear: YEAR })
  const result = simulate(c, deterministicPath(c.years, returnPct, inflationPct))
  return { c, result, rows: result.rows, first: result.rows[0] }
}
const budget = (amount: number, extra: object = {}) => ({ mode: 'detailed' as const, items: [{ id: 'e', amount, ...extra }] })
const EXPENSES = { strategy: { kind: 'expenses' as const } }

describe('funding verdicts', () => {
  it('fails a household with no money under every strategy', () => {
    const strategies = [
      { kind: 'expenses' }, { kind: 'initialPct', ratePct: 4 }, { kind: 'pctPortfolio', ratePct: 4 },
      { kind: 'guytonKlinger', initialRatePct: 4 }, { kind: 'vpw' },
    ]
    for (const strategy of strategies) {
      const { result, first } = run(plan({ people: [person(70, 65)], expenses: budget(30000), drawdown: { strategy: strategy as never } }))
      expect(runSucceeded(result)).toBe(false)
      expect(first.budgetShortfall).toBe(30000)
      expect(first.essentialShortfall).toBe(30000)
      expect(result.depletionOffset).toBe(0)
    }
  })

  it('does not fail a flexible strategy for trimming discretionary spending', () => {
    const { result, rows } = run(plan({
      people: [person(70, 65, { lifeExpectancy: 72 })],
      accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 100000 }],
      expenses: { mode: 'detailed', items: [{ id: 'need', amount: 10000, essential: true }, { id: 'want', amount: 60000, essential: false }] },
      drawdown: { strategy: { kind: 'pctPortfolio', ratePct: 12 } },
    }))
    expect(rows[0].budgetShortfall).toBeGreaterThan(0)
    expect(rows[0].essentialShortfall).toBe(0)
    expect(runSucceeded(result)).toBe(true)
  })

  it('has nothing to test in simple mode with no withdrawals', () => {
    const { c, result } = run(plan({ people: [person(70, 65)] }))
    expect(successIsMeaningful(c, result)).toBe(false)
  })
})

describe('one cash-flow calculation', () => {
  it('taxes a gift from an RRSP and reports what it could not pay', () => {
    const gift = { mode: 'simple' as const, items: [{ id: 'g', category: 'gift', amount: 100000, frequency: 'oneTime' as const, from: { kind: 'now' as const } }] }
    const { result, first } = run(plan({ people: [person(70, 65)], accounts: [{ id: 'r', type: 'RRSP', ownerId: 'a', balance: 100000 }], expenses: gift }))
    expect(first.withdrawal).toBeCloseTo(100000, 0)
    expect(first.tax).toBeGreaterThan(10000)
    expect(first.oneTimeExpenses).toBeCloseTo(100000 - first.tax, 0)
    expect(first.shortfall).toBeCloseTo(first.tax, 0)
    expect(runSucceeded(result)).toBe(false)
  })

  it('reports a gift with nothing to pay it from', () => {
    const gift = { mode: 'simple' as const, items: [{ id: 'g', category: 'gift', amount: 5000, frequency: 'oneTime' as const, from: { kind: 'now' as const } }] }
    const { result, first } = run(plan({ people: [person(70, 65)], expenses: gift }))
    expect(first.shortfall).toBe(5000)
    expect(runSucceeded(result)).toBe(false)
  })

  it('pays a gift on its own date, before retirement', () => {
    const gift = { mode: 'simple' as const, items: [{ id: 'g', category: 'gift', amount: 10000, frequency: 'oneTime' as const, from: { kind: 'year' as const, year: YEAR + 2 } }] }
    const { rows } = run(plan({ people: [person(40, 65)], accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 50000 }], expenses: gift }))
    expect(rows[2].oneTimeExpenses).toBe(10000)
    expect(rows[2].balancesEnd[0]).toBe(40000)
    expect(rows[25].oneTimeExpenses).toBe(0)
  })

  it('keeps mortgage debt a sale could not repay', () => {
    const { result, first } = run(plan({
      people: [person(70, 65)],
      properties: [{ id: 'h', ownerId: 'a', value: 100000, sale: { at: { kind: 'now' }, sellingCostPct: 0 } }],
      debts: [{ id: 'm', balance: 200000, interestRatePct: 0, monthlyPayment: 0, propertyId: 'h' }],
      expenses: budget(0),
    }))
    expect(first.debtBalance).toBe(100000)
    expect(first.netWorth).toBe(-100000)
    expect(runSucceeded(result)).toBe(false)
  })

  it('pays the rest of a mortgage from savings, with tax on an RRSP', () => {
    const { first } = run(plan({
      people: [person(70, 65)],
      accounts: [{ id: 'r', type: 'RRSP', ownerId: 'a', balance: 500000 }],
      properties: [{ id: 'h', ownerId: 'a', value: 100000, sale: { at: { kind: 'now' }, sellingCostPct: 0 } }],
      debts: [{ id: 'm', balance: 150000, interestRatePct: 0, monthlyPayment: 0, propertyId: 'h' }],
      drawdown: { strategy: { kind: 'initialPct', ratePct: 0.01 } },
    }))
    expect(first.debtBalance).toBe(0)
    expect(first.tax).toBeGreaterThan(5000)
    expect(first.withdrawal).toBeGreaterThan(50000)
  })

  it('does not invent a working-year shortfall after a draw', () => {
    const { first } = run(plan({ people: [person(30, 65)], accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 10000 }], expenses: budget(8000) }))
    expect(first.withdrawal).toBeCloseTo(8000, 0)
    expect(first.balancesEnd[0]).toBeCloseTo(2000, 0)
    expect(first.shortfall).toBe(0)
  })

  it('counts employment after retirement as cash', () => {
    const { first } = run(plan({
      people: [person(65, 60)],
      incomes: [{ id: 'j', ownerId: 'a', kind: 'employment', amount: 50000, growth: { kind: 'none' } }],
      expenses: budget(30000), drawdown: EXPENSES,
    }))
    expect(first.grossIncome).toBe(50000)
    expect(first.afterTaxIncome).toBeCloseTo(50000 - first.tax - first.people[0].payroll, 2)
    expect(first.shortfall).toBe(0)
  })

  it('charges payroll when solving what a retiree must withdraw', () => {
    const p = (employment: number) => plan({
      people: [person(65, 60)],
      accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 500000 }],
      incomes: [{ id: 'j', ownerId: 'a', kind: 'employment', amount: employment, growth: { kind: 'none' } }],
      expenses: budget(40000), drawdown: EXPENSES,
    })
    const { first } = run(p(30000))
    expect(first.afterTaxIncome).toBeCloseTo(40000, -1)
    expect(first.people[0].payroll).toBeGreaterThan(1000)
  })

  it('pays GIS before the household starts drawing down', () => {
    const { first } = run(plan({ people: [person(65, 70, { oas: { startAge: 65, yearsInCanadaAfter18: 40 } })], expenses: budget(20000) }))
    expect(first.phase).toBe('accumulation')
    expect(first.gis).toBeGreaterThan(10000)
    expect(first.shortfall).toBe(0)
  })

  it('runs a contribution scheduled past retirement when cash allows', () => {
    const { rows } = run(plan({
      people: [person(60, 62)],
      incomes: [{ id: 'p', ownerId: 'a', kind: 'dbPension', amount: 80000, growth: { kind: 'none' } }],
      accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 0, contributions: [{ amount: 5000, to: { kind: 'year', year: YEAR + 4 } }] }],
      expenses: budget(30000), drawdown: EXPENSES,
    }))
    expect(rows[2].phase).toBe('drawdown')
    expect(rows[3].contributions).toBe(5000)
    // Four $5,000 contributions, plus surplus cash up to the $7,000 limit in
    // each of the two retired years.
    expect(rows[3].balancesEnd[0]).toBe(24000)
    expect(rows[4].contributions).toBe(0)
  })

  it('stops contributions when the contributor dies, despite the rollover', () => {
    const { rows } = run(plan({
      people: [person(60, 62, { lifeExpectancy: 61 }), spouse(40, 65)],
      accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 0, contributions: [{ amount: 5000, to: { kind: 'year', year: YEAR + 6 } }] }],
    }))
    expect(rows[1].contributions).toBe(5000)
    expect(rows[2].contributions).toBe(0)
  })
})

describe('returns', () => {
  it('reproduces a supplied annual return with no cash flows', () => {
    const p = plan({ people: [person(30, 65)], accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 100000 }] })
    expect(run(p, 10).first.balancesEnd[0]).toBeCloseTo(110000, 4)
    expect(run(p, -50).first.balancesEnd[0]).toBeCloseTo(50000, 4)
  })

  it('never lets a return spread create a negative balance', () => {
    const p = plan({ people: [person(70, 65)], accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 100000, returnOverridePct: -50 }], assumptions: { expectedReturn: 7 } })
    expect(run(p, -80).first.balancesEnd[0]).toBe(0)
  })
})

describe('tax and registered accounts', () => {
  const couple = (accounts: PlanV2Input['accounts'], conversion = 71) => plan({
    people: [person(66, 65), spouse(66, 65)],
    accounts,
    expenses: budget(60000),
    drawdown: { strategy: { kind: 'expenses' }, rrifConversionAge: conversion },
  })

  it('splits RRIF income but not an unconverted RRSP', () => {
    const first = (type: 'RRSP' | 'RRIF', conversion?: number) => run(couple([{ id: 'x', type, ownerId: 'a', balance: 1000000 }], conversion)).first
    expect(first('RRSP').people[0].pensionSplit).toBe(0)
    expect(Math.abs(first('RRIF').people[0].pensionSplit)).toBeGreaterThan(10000)
    expect(Math.abs(first('RRSP', 65).people[0].pensionSplit)).toBeGreaterThan(10000)
  })

  it('does not give the pension credit on non-eligible registered income', () => {
    const eligible = computeHouseholdTax([{ ...emptyIncome('ON', 65), registeredWithdrawals: 30000 }], {}).total
    const ordinary = computeHouseholdTax([{ ...emptyIncome('ON', 65), registeredWithdrawals: 30000, nonEligibleRegistered: 30000 }], {}).total
    expect(ordinary).toBeGreaterThan(eligible)
  })

  it('stops CPP at 70 and QPP the year the person turns 73', () => {
    expect(payrollContributions(50000, 'ON', TAX_2026, { age: 69 }).pensionBase).toBeGreaterThan(0)
    expect(payrollContributions(50000, 'ON', TAX_2026, { age: 70 }).pensionBase).toBe(0)
    expect(payrollContributions(50000, 'QC', TAX_2026, { age: 72 }).pensionBase).toBeGreaterThan(0)
    expect(payrollContributions(50000, 'QC', TAX_2026, { age: 73 }).pensionBase).toBe(0)
  })

  it('charges both CPP halves and no EI on self-employment', () => {
    const r = payrollContributions(0, 'ON', TAX_2026, { age: 40, selfEmployment: 50000 })
    expect(r.ei).toBe(0)
    expect(r.total).toBeCloseTo(46500 * 0.0595 * 2, 2)
    expect(r.selfEmployedEmployerBase).toBeCloseTo(46500 * 0.0495, 2)
  })

  it('lets a Quebec LIF pay more than the formula maximum', () => {
    const p = (province: 'QC' | 'ON') => plan({
      people: [person(60, 55, { province })],
      accounts: [{ id: 'l', type: 'LIF', ownerId: 'a', balance: 100000 }],
      expenses: budget(30000), drawdown: EXPENSES,
    })
    expect(run(p('QC')).first.shortfall).toBe(0)
    // January 1 age 59: 6.77% in the 2026 common column.
    expect(run(p('ON')).first.withdrawal).toBeCloseTo(6770, -1)
  })

  it('follows the account jurisdiction, not the home province', () => {
    const p = plan({
      people: [person(60, 55, { province: 'QC' })],
      accounts: [{ id: 'l', type: 'LIF', ownerId: 'a', balance: 100000, jurisdiction: 'FED' }],
      expenses: budget(30000), drawdown: EXPENSES,
    })
    // January 1 age 59: 5.46% in the 2026 federal column.
    expect(run(p).first.withdrawal).toBeCloseTo(5460, -1)
  })

  it('allows QPP deferral to 72 but stops CPP growth at 70', () => {
    expect(getCppIncomeAtAge(10000, 72, 72, 72)).toBeCloseTo(15880, 6)
    expect(getCppIncomeAtAge(10000, 72, 72)).toBeCloseTo(14200, 6)
  })

  it('uses the 2026 Manitoba and PEI figures', () => {
    expect(computeIncomeTax({ ...emptyIncome('MB', 40), otherOrdinary: 120000 }).provincial).toBeCloseTo(13609.26, 2)
    expect(TAX_2026.provinces.MB.bracketsIndexed).toBe(false)
    expect(TAX_2026.provinces.PE.creditRatePct).toBe(9.5)
  })

  it('lets only Ontario thresholds fixed in law erode', () => {
    const today = computeIncomeTax({ ...emptyIncome('ON', 40), otherOrdinary: 140000 })
    const later = computeIncomeTax({ ...emptyIncome('ON', 40), otherOrdinary: 140000 }, { deflator: 0.5 })
    expect(later.provincial).toBeGreaterThan(today.provincial)
    expect(bracketPosition(100000, 'ON', 0.5).nextThreshold).toBe(107785)
    expect(bracketPosition(70000, 'ON', 0.5).nextThreshold).toBe(75000)
  })

  it('shares FHSA limits across a person\'s accounts', () => {
    const fhsa = (id: string) => ({ id, type: 'FHSA' as const, ownerId: 'a', balance: 0, contributions: [{ amount: 8000 }] })
    const { rows } = run(plan({ people: [person(30, 65)], accounts: [fhsa('x'), fhsa('y')] }))
    expect(rows[0].contributions).toBe(8000)
    expect(rows.reduce((s, r) => s + r.contributions, 0)).toBe(40000)
  })

  it('caps automatic TFSA deposits at the room available', () => {
    const { first } = run(plan({
      people: [person(80, 65, { room: { tfsa: 0 } })],
      accounts: [{ id: 'r', type: 'RRIF', ownerId: 'a', balance: 100000 }, { id: 't', type: 'TFSA', ownerId: 'a', balance: 0 }],
      drawdown: { strategy: { kind: 'initialPct', ratePct: 0.01 } },
    }))
    expect(first.reinvested).toBeGreaterThan(5000)
    expect(first.balancesEnd[1]).toBe(0)
    expect(first.people[0].tfsaRoom).toBe(0)
  })
})

describe('choosing when an RRSP converts', () => {
  const rrsp = (id: string, extra: object = {}) => ({ id, type: 'RRSP' as const, ownerId: 'a', balance: 100000, ...extra })
  const lowDraw = { strategy: { kind: 'initialPct' as const, ratePct: 0.01 } }

  it('counts as pension income from the year of conversion, with no minimum yet', () => {
    const { first } = run(plan({
      people: [person(66, 65), spouse(66, 65)],
      accounts: [rrsp('r', { balance: 1000000 })],
      expenses: budget(60000),
      drawdown: { strategy: { kind: 'expenses' }, rrifConversionAge: 66 },
    }))
    expect(Math.abs(first.people[0].pensionSplit)).toBeGreaterThan(10000)
    expect(first.people[0].minimumWithdrawals).toBe(0)
  })

  it('starts the minimum the year after conversion', () => {
    const { rows } = run(plan({ people: [person(64, 60)], accounts: [rrsp('r')], drawdown: { ...lowDraw, rrifConversionAge: 65 } }))
    expect(rows[1].people[0].age).toBe(65)
    expect(rows[1].people[0].minimumWithdrawals).toBe(0)
    expect(rows[2].people[0].minimumWithdrawals).toBeGreaterThan(0)
  })

  it('allows conversion well before 55', () => {
    const { first } = run(plan({ people: [person(45, 40)], accounts: [rrsp('r')], drawdown: { ...lowDraw, rrifConversionAge: 40 } }))
    expect(first.people[0].minimumWithdrawals).toBeCloseTo(100000 / (90 - 44), 2)
  })

  it('rejects a conversion after 71', () => {
    expect(planSchema.safeParse({ schemaVersion: 2, id: 'p', asOf: '2026-01-01', people: [person(40, 65)], drawdown: { rrifConversionAge: 72 } }).success).toBe(false)
  })

  it('lets one account convert early while another waits, for a partial conversion', () => {
    const { first } = run(plan({
      people: [person(66, 65)],
      accounts: [rrsp('early', { rrifConversionAge: 65 }), rrsp('later')],
      drawdown: lowDraw,
    }))
    expect(first.people[0].minimumWithdrawals).toBeCloseTo(100000 / (90 - 65), 2)
  })

  it('does not force a LIRA to pay out because of the RRSP setting', () => {
    const { first } = run(plan({
      people: [person(60, 65)],
      accounts: [{ id: 'l', type: 'LIRA', ownerId: 'a', balance: 100000 }],
      drawdown: { ...lowDraw, rrifConversionAge: 58 },
    }))
    expect(first.people[0].minimumWithdrawals).toBe(0)
    expect(first.withdrawal).toBe(0)
  })

  it('shows one milestone for each conversion age', () => {
    const p = plan({ people: [person(40, 65)], accounts: [rrsp('early', { rrifConversionAge: 65 }), rrsp('later')] })
    const { c, result } = run(p)
    const years = buildMilestones(p, c, result).filter(m => m.kind === 'rrif').map(m => m.year)
    expect(years).toEqual([YEAR + 25, YEAR + 31])
  })

  it('warns when contributions run past conversion', () => {
    const p = plan({ people: [person(40, 65)], accounts: [rrsp('r', { rrifConversionAge: 60, contributions: [{ amount: 1000 }] })] })
    expect(diagnosePlan(p, NOW).map(d => d.message).join()).toContain('cannot take contributions')
    const fine = plan({ people: [person(40, 65)], accounts: [rrsp('r', { rrifConversionAge: 65, contributions: [{ amount: 1000 }] })] })
    expect(diagnosePlan(fine, NOW)).toEqual([])
  })
})

describe('dates and estate-independent events', () => {
  it('does not repay a one-time income from a past year', () => {
    const windfall = (year: number) => plan({ people: [person(40, 65)], incomes: [{ id: 'w', ownerId: 'a', kind: 'windfall', amount: 100000, frequency: 'oneTime', from: { kind: 'year', year }, taxTreatment: 'nonTaxable', growth: { kind: 'none' } }] })
    expect(run(windfall(2025)).first.deposits).toBe(0)
    expect(run(windfall(2026)).first.deposits).toBe(100000)
  })

  it('keeps a stock event on its date when the person it points to is deleted', () => {
    const p = plan({
      people: [person(40, 65), spouse(40, 65)],
      accounts: [{ id: 's', type: 'STOCK', ownerId: 'a', balance: 0, holdings: [{ id: 'h', symbol: 'X', shares: 1, priceUsd: 1, rsuGrants: [{ id: 'g', shares: 10, vestAt: { kind: 'age', personId: 'b', age: 42 } }] }] }],
    })
    const after = deletePerson(p, 'b', YEAR)
    expect(compilePlan(after, { startYear: YEAR }).accounts[0].stock!.holdings[0].grants[0].offset).toBe(2)
  })

  it('never extends a contribution when testing Coast FI', () => {
    const p = plan({ people: [person(40, 65)], accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 0, contributions: [{ amount: 1, to: { kind: 'year', year: 2027 } }] }] })
    expect(withContributionsStoppingIn(p, 2030, YEAR).accounts[0].contributions[0].to).toEqual({ kind: 'year', year: 2027 })
    expect(withContributionsStoppingIn(p, 2026, YEAR).accounts[0].contributions[0].to).toEqual({ kind: 'year', year: 2026 })
  })
})

describe('unfunded spending is visible', () => {
  it('shows a budget nobody paid for in the Sankey', () => {
    const { first } = run(plan({ people: [person(70, 65)], expenses: budget(30000) }))
    const names = buildSankeyData(first).nodes.map(n => n.name)
    expect(names).toContain('Unfunded spending')
    expect(names).toContain('Spending')
  })
})

describe('storage recovery', () => {
  const memory = (initial: Record<string, string> = {}) => {
    const data = new Map(Object.entries(initial))
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) }, data }
  }
  const good = plan({ people: [person(40, 65)] })
  const bad = { ...good, id: 'bad', name: 'Broken', people: [] }

  it('reports an invalid plan and keeps the original text', () => {
    const raw = JSON.stringify({ schemaVersion: 2, activePlanId: 'p', plans: [good, bad] })
    const storage = memory({ [STORE_KEY]: raw })
    const { state, recovery } = loadStoreWithRecovery(storage, NOW)
    expect(state.plans.map(p => p.id)).toEqual(['p'])
    expect(recovery?.problems[0]).toContain('Broken')
    expect(preserveRecovery(storage, recovery!, NOW)).toBe(true)
    expect(readRecoveryEntries(storage)[0].raw).toBe(raw)
  })

  it('keeps the original when every plan is unreadable or the file is corrupt', () => {
    for (const raw of [JSON.stringify({ schemaVersion: 2, activePlanId: 'bad', plans: [bad] }), '{not json']) {
      const { recovery } = loadStoreWithRecovery(memory({ [STORE_KEY]: raw }), NOW)
      expect(recovery?.raw).toBe(raw)
    }
  })

  it('reports nothing for healthy data and first runs', () => {
    const raw = serializeStore({ activePlanId: 'p', plans: [good], uiPrefs: { showRealValues: true, detailLevel: 'essentials' }, snapshots: [], baselines: [] })!
    expect(loadStoreWithRecovery(memory({ [STORE_KEY]: raw }), NOW).recovery).toBeNull()
    expect(loadStoreWithRecovery(memory(), NOW).recovery).toBeNull()
  })

  it('tells the caller when the copy could not be written', () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error('full') } }
    expect(preserveRecovery(storage, { raw: 'x', problems: ['y'] }, NOW)).toBe(false)
  })

  const withEntries = (extra: object) => JSON.stringify({ schemaVersion: 2, activePlanId: 'p', plans: [good], ...extra })
  const snapshot = { id: 's', planId: 'p', date: '2026-01-01', balances: {}, total: 1 }

  it('keeps the valid entries of a list with a bad one, and reports it', () => {
    const raw = withEntries({ snapshots: [snapshot, { id: 'bad' }] })
    const { state, recovery } = loadStoreWithRecovery(memory({ [STORE_KEY]: raw }), NOW)
    expect(state.snapshots.map(s => s.id)).toEqual(['s'])
    expect(recovery?.raw).toBe(raw)
  })

  it('reports a list that is the wrong shape instead of emptying it silently', () => {
    const raw = withEntries({ baselines: { nope: true } })
    const { state, recovery } = loadStoreWithRecovery(memory({ [STORE_KEY]: raw }), NOW)
    expect(state.baselines).toEqual([])
    expect(recovery?.problems.join()).toContain('baselines')
  })

  it('reports tracking data whose plan could not be read', () => {
    const raw = withEntries({ snapshots: [{ ...snapshot, planId: 'gone' }] })
    expect(loadStoreWithRecovery(memory({ [STORE_KEY]: raw }), NOW).recovery?.problems.join()).toContain('could not be read')
  })

  it('opens an unsaved session when storage is blocked', () => {
    const blocked = { getItem: () => { throw new Error('denied') } }
    const { state, recovery, unavailable } = loadStoreWithRecovery(blocked, NOW)
    expect(unavailable).toBe(true)
    expect(recovery).toBeNull()
    expect(state.plans).toHaveLength(1)
    expect(readRecoveryEntries(blocked)).toEqual([])
  })

  it('does not store the same copy twice', () => {
    const storage = memory()
    preserveRecovery(storage, { raw: 'x', problems: ['y'] }, NOW)
    preserveRecovery(storage, { raw: 'x', problems: ['y'] }, NOW)
    expect(JSON.parse(storage.data.get(RECOVERY_KEY)!)).toHaveLength(1)
  })
})

describe('app boundaries', () => {
  it('refuses a share link that inflates past the limit', () => {
    const bomb = deflateSync(strToU8('x'.repeat(3 * 1024 * 1024)), { level: 9 })
    let binary = ''
    bomb.forEach(b => { binary += String.fromCharCode(b) })
    const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
    expect(encoded.length).toBeLessThan(128 * 1024)
    expect(decodePlan(encoded)).toBeNull()
  })

  it('refuses an oversized encoded link before decoding', () => {
    expect(decodePlan('A'.repeat(128 * 1024 + 1))).toBeNull()
  })

  it('still round-trips a normal plan through a share link', () => {
    const p = plan({ people: [person(40, 65)] })
    expect(decodePlan(encodePlan(p))?.plan.people[0].name).toBe('A')
  })

  it('refuses an oversized YAML file', () => {
    expect(importFromYAML('#'.repeat(2 * 1024 * 1024 + 1))).toBeNull()
  })

  it('neutralizes formula prefixes in text cells but not numbers', () => {
    expect(toCsv(['=SUM(A1)'], [['+1', '-2', '@x', 'plain', -5]])).toBe("'=SUM(A1)\r\n'+1,'-2,'@x,plain,-5")
  })

  it('spaces quote requests by each provider\'s limit', () => {
    expect(QUOTE_PROVIDERS.twelvedata.minIntervalMs).toBeGreaterThanOrEqual(7500) // 8 a minute
    expect(QUOTE_PROVIDERS.alphavantage.minIntervalMs).toBeGreaterThanOrEqual(1000)
  })
})

describe('plan diagnostics', () => {
  const base = { people: [person(40, 65)] }
  const messages = (p: PlanV2) => diagnosePlan(p, NOW).map(d => d.message).join(' | ')

  it('is silent for a clean plan', () => {
    expect(diagnosePlan(plan(base), NOW)).toEqual([])
  })

  it('reports what the engine cannot honour, without rejecting the plan', () => {
    expect(messages(plan({ ...base, incomes: [{ id: 'i', ownerId: 'joint', kind: 'employment', amount: 1 }] }))).toContain('joint')
    expect(messages(plan({ ...base, accounts: [{ id: 'r', type: 'RRSP', ownerId: 'joint', balance: 1 }] }))).toContain('joint')
    expect(messages(plan({ ...base, accounts: [{ id: 'r', type: 'TFSA', ownerId: 'a', balance: 1 }, { id: 'r', type: 'TFSA', ownerId: 'a', balance: 1 }] }))).toContain('share the id')
    expect(messages(plan({ ...base, incomes: [{ id: 'i', ownerId: 'a', kind: 'employment', amount: 1, from: { kind: 'age', personId: 'zzz', age: 50 } }] }))).toContain('not in this plan')
    expect(messages(plan({ ...base, asOf: '2026-99-99' }))).toContain('not a real date')
    expect(messages(plan({ people: [person(40, 65), spouse(40, 65), person(40, 65, { id: 'c', name: 'C' })] }))).toContain('more than two')
  })

  it('reports people past their lifespan and retirement after it', () => {
    expect(messages(plan({ people: [person(90, 65, { lifeExpectancy: 85 })] }))).toContain('life expectancy')
    expect(messages(plan({ people: [person(40, 90, { lifeExpectancy: 85 })] }))).toContain('retires at 90')
  })

  it('reports contributions over known room, and not when room is unknown', () => {
    const accounts: PlanV2Input['accounts'] = [{ id: 'r', type: 'RRSP', ownerId: 'a', balance: 0, contributions: [{ amount: 5000 }] }]
    expect(messages(plan({ people: [person(40, 65, { room: { rrsp: 1000 } })], accounts }))).toContain('more than the RRSP room')
    expect(messages(plan({ people: [person(40, 65)], accounts }))).not.toContain('room')
  })

  it('reports stock pay on a joint account', () => {
    expect(messages(plan({ ...base, accounts: [{ id: 's', type: 'STOCK', ownerId: 'joint', balance: 0, holdings: [{ id: 'h', symbol: 'X', shares: 1, priceUsd: 1, espp: { annualContribution: 1 } }] }] }))).toContain('joint')
  })

  it('flags balances from an earlier year', () => {
    expect(messages(plan({ ...base, asOf: '2024-05-01' }))).toContain('2024-05-01')
  })

  it('recognises real dates', () => {
    expect(isRealDate('2024-02-29')).toBe(true)
    expect(isRealDate('2025-02-29')).toBe(false)
  })
})

describe('money forced out of registered accounts', () => {
  const retiree = (spend: number, extra: Partial<PlanV2Input> = {}) => plan({
    people: [person(75, 65)],
    accounts: [{ id: 'r', ownerId: 'a', type: 'RRIF', balance: 1_000_000 }, { id: 'n', ownerId: 'a', type: 'NONREG', balance: 0 }],
    expenses: { mode: 'detailed', items: [{ id: 'e', label: 'Living', amount: spend, frequency: 'annual' }] },
    drawdown: { strategy: { kind: 'expenses' } },
    ...extra,
  })
  const firstRow = (p: PlanV2) => {
    const c = compilePlan(p, { startYear: YEAR })
    return simulate(c, deterministicPath(c.years, 0, 0)).rows[0]
  }

  it('spends a RRIF minimum that more than covers the budget', () => {
    const row = firstRow(retiree(30_000))
    expect(row.withdrawal).toBeCloseTo(56_700, 0)
    expect(row.shortfall).toBe(0)
    expect(row.afterTaxIncome).toBeGreaterThanOrEqual(30_000)
    // Only what is left after spending and tax goes back in.
    expect(row.reinvested).toBeCloseTo(row.withdrawal - row.tax - 30_000, 0)
    expect(row.balancesEnd[0] + row.balancesEnd[1]).toBeCloseTo(1_000_000 - 30_000 - row.tax, 0)
  })

  it('treats a bigger budget no worse than a smaller one', () => {
    const shortfalls = [20_000, 30_000, 40_000, 60_000, 70_000].map(spend => firstRow(retiree(spend)).shortfall)
    expect(shortfalls).toEqual([0, 0, 0, 0, 0])
  })

  it('reinvests only the excess of a RRIF minimum in simple mode', () => {
    const p = retiree(0, {
      people: [person(70, 73)],
      incomes: [{ id: 'i', ownerId: 'a', label: 'Salary', kind: 'employment', amount: 40_000, frequency: 'annual', to: { kind: 'retirement', personId: 'a', offset: 0 } }],
      expenses: { mode: 'simple', replacementRate: 75 },
    })
    const c = compilePlan(p, { startYear: YEAR })
    const row = simulate(c, deterministicPath(c.years, 0, 0)).rows[c.drawdownStartOffset]
    expect(c.simpleSpendingTarget).toBe(30_000)
    const minimum = row.people[0].minimumWithdrawals
    expect(minimum).toBeGreaterThan(c.simpleSpendingTarget)
    expect(row.withdrawal).toBeCloseTo(minimum, 0)
    expect(row.grossIncome).toBeGreaterThanOrEqual(c.simpleSpendingTarget - 1)
    expect(row.reinvested).toBeLessThanOrEqual(minimum - c.simpleSpendingTarget + 1)
  })

  it('counts GIS lost to a meltdown before reinvesting', () => {
    const p = plan({
      people: [person(70, 65, { oas: { startAge: 65, yearsInCanadaAfter18: 40 } })],
      accounts: [
        { id: 't', ownerId: 'a', type: 'TFSA', balance: 300_000 },
        { id: 'r', ownerId: 'a', type: 'RRSP', balance: 500_000 },
      ],
      expenses: { mode: 'detailed', items: [{ id: 'e', label: 'Living', amount: 25_000, frequency: 'annual' }] },
      drawdown: {
        strategy: { kind: 'expenses' },
        order: 'custom',
        customOrder: ['TFSA', 'CASH', 'STOCK', 'NONREG', 'RRIF', 'RRSP', 'LIF', 'LIRA', 'FHSA'],
        meltdown: { enabled: true, targetTaxableIncome: 60_000 },
      },
    })
    const row = firstRow(p)
    const without = firstRow({ ...p, drawdown: { ...p.drawdown, meltdown: { enabled: false, targetTaxableIncome: 60_000 } } })
    expect(without.gis).toBeGreaterThan(0)
    expect(row.gis).toBeLessThan(without.gis)
    expect(row.meltdownWithdrawals).toBeGreaterThan(0)
    expect(row.shortfall).toBe(0)
    expect(row.afterTaxIncome).toBeCloseTo(25_000, 0)
  })
})

// November 2026 audit. Expected figures are worked out by hand or come from the
// cited source, never from calling the code being tested.
describe('money cannot appear or vanish', () => {
  const total = (values: number[]) => values.reduce((s, v) => s + v, 0)
  const nonTaxable = (id: string, amount: number) => ({ id, ownerId: 'a', kind: 'other' as const, amount, taxTreatment: 'nonTaxable' as const, growth: { kind: 'none' as const } })
  const gift = (amount: number) => ({ mode: 'simple' as const, items: [{ id: 'g', category: 'gift', amount, frequency: 'oneTime' as const, from: { kind: 'now' as const } }] })
  const LOW_DRAW = { strategy: { kind: 'initialPct' as const, ratePct: 0.01 } }

  it('creates no asset from a contribution nobody can pay for', () => {
    const { first, rows } = run(plan({
      people: [person(30, 65)], expenses: budget(0),
      accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 0, contributions: [{ amount: 10000 }] }],
    }))
    expect(first.balancesEnd[0]).toBe(0)
    expect(first.contributions).toBe(0)
    expect(first.scheduledContributions).toBe(10000)
    expect(first.missedContributions).toBe(10000)
    expect(first.shortfall).toBe(0)
    expect(rows[1].withdrawal).toBe(0)
  })

  it('never sells assets to fund a contribution', () => {
    const { first } = run(plan({
      people: [person(30, 65)], expenses: budget(0),
      accounts: [
        { id: 't', type: 'TFSA', ownerId: 'a', balance: 50000 },
        { id: 'r', type: 'RRSP', ownerId: 'a', balance: 0, contributions: [{ amount: 10000 }] },
      ],
    }))
    expect(first.withdrawal).toBe(0)
    expect(first.balancesEnd.slice(0, 2)).toEqual([50000, 0])
  })

  it('saves only the part cash can pay for', () => {
    const { first } = run(plan({
      people: [person(30, 65)], expenses: budget(10000), incomes: [nonTaxable('i', 20000)],
      accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 0, contributions: [{ amount: 20000 }] }],
    }))
    expect(first.contributions).toBeCloseTo(10000, 1)
    expect(first.missedContributions).toBeCloseTo(10000, 1)
    expect(first.balancesEnd[0]).toBeCloseTo(10000, 1)
    expect(first.shortfall).toBe(0)
  })

  it('lets a deduction help pay for the contribution that earns it', () => {
    // $60,000 pension, $20,000 spending: the RRSP contribution's own deduction
    // frees cash, so more is saved than income less no-deduction tax would allow.
    const pension = { id: 'p', ownerId: 'a', kind: 'dbPension' as const, amount: 60000, growth: { kind: 'none' as const } }
    const { first } = run(plan({
      people: [person(60, 65)], expenses: budget(20000), incomes: [pension],
      accounts: [{ id: 'r', type: 'RRSP', ownerId: 'a', balance: 0, contributions: [{ amount: 60000 }] }],
    }))
    const cashLeft = 60000 - first.tax - first.spending - first.contributions
    expect(cashLeft).toBeCloseTo(0, 0)
    expect(first.missedContributions).toBeGreaterThan(0)
    expect(first.withdrawal).toBe(0)
  })

  it('buys no ESPP shares without cash', () => {
    const { first } = run(plan({
      people: [person(70, 65)], expenses: budget(0),
      accounts: [{ id: 's', type: 'STOCK', ownerId: 'a', balance: 0, holdings: [{ id: 'h', symbol: 'X', shares: 0, priceUsd: 1, espp: { annualContribution: 10000, to: { kind: 'year', year: YEAR + 5 } } }] }],
    }))
    expect(first.balancesEnd[0]).toBe(0)
    expect(first.stockCompensation).toBe(0)
    expect(first.contributions).toBe(0)
    expect(first.missedContributions).toBe(10000)
  })

  it('keeps a debt nobody could pay', () => {
    const debts = [{ id: 'l', balance: 6000, interestRatePct: 0, monthlyPayment: 500 }]
    const { rows } = run(plan({ people: [person(70, 65)], debts, expenses: budget(0), drawdown: EXPENSES }))
    expect(rows[0].debtPayments).toBe(0)
    expect(rows[0].debtBalance).toBe(6000)
    expect(rows[0].shortfall).toBe(6000)
    expect(rows[1].spending).toBe(6000)
    expect(rows[1].debtBalance).toBe(6000)
  })

  it('pays down a debt in proportion to what essentials could be paid', () => {
    const debts = [{ id: 'l', balance: 6000, interestRatePct: 0, monthlyPayment: 500 }]
    const { first } = run(plan({ people: [person(70, 65)], debts, incomes: [nonTaxable('i', 3000)], expenses: budget(0), drawdown: EXPENSES }))
    expect(first.debtPayments).toBeCloseTo(3000, 2)
    expect(first.debtBalance).toBeCloseTo(3000, 2)
  })

  it('compounds a mortgage rate twice a year when asked', () => {
    // (1 + 0.06 / 2) ^ 2 = 1.0609, against (1 + 0.06 / 12) ^ 12 = 1.0616778.
    expect(amortizeYear(100000, 0.06, 0, 'semiAnnual').balance).toBeCloseTo(106090, 2)
    expect(amortizeYear(100000, 0.06, 0).balance).toBeCloseTo(106167.78, 2)
  })

  it('charges a gift only what it costs, with RRIF minimums untouched', () => {
    const accounts: PlanV2Input['accounts'] = [{ id: 'r', type: 'RRIF', ownerId: 'a', balance: 1000000 }]
    const base = { people: [person(75, 65)], accounts, drawdown: { strategy: { kind: 'initialPct' as const, ratePct: 4 } } }
    const nextYear = { ...gift(1000), items: gift(1000).items.map(i => ({ ...i, from: { kind: 'year' as const, year: YEAR + 1 } })) }
    const none = run(plan(base)).rows[1]
    const paid = run(plan({ ...base, expenses: nextYear })).rows[1]
    const cost = total(none.balancesEnd) - total(paid.balancesEnd)
    expect(paid.oneTimeExpenses).toBeCloseTo(1000, 0)
    // The RRIF minimum comes out either way, so the gift adds no tax.
    expect(cost).toBeCloseTo(1000, 0)
  })

  it('charges a TFSA-funded gift exactly its amount', () => {
    const accounts: PlanV2Input['accounts'] = [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 100000 }]
    const { first } = run(plan({ people: [person(40, 65)], accounts, expenses: gift(1000) }))
    expect(first.balancesEnd[0]).toBe(99000)
  })

  const saleOf = (principalResidence: boolean, expenses: PlanV2Input['expenses'], drawdown: PlanV2Input['drawdown']) => plan({
    people: [person(70, 65)],
    accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 200000 }],
    properties: [{ id: 'h', ownerId: 'a', value: 600000, acb: 100000, isPrincipalResidence: principalResidence, sale: { at: { kind: 'now' }, sellingCostPct: 0 } }],
    expenses, drawdown,
  })

  it('takes the tax on a sale out of the proceeds in simple mode', () => {
    const taxable = run(saleOf(false, {}, LOW_DRAW)).first
    const exempt = run(saleOf(true, {}, LOW_DRAW)).first
    const extraTax = taxable.tax - exempt.tax
    expect(extraTax).toBeGreaterThan(50000)
    expect(total(exempt.balancesEnd) - total(taxable.balancesEnd)).toBeCloseTo(extraTax, -2)
    // Spending power isn't hit twice: the tax already came out of the proceeds.
    expect(taxable.afterTaxIncome).toBeCloseTo(exempt.afterTaxIncome, -2)
  })

  it('charges the tax on a sale only once in detailed mode', () => {
    const taxable = run(saleOf(false, budget(30000), EXPENSES)).first
    const exempt = run(saleOf(true, budget(30000), EXPENSES)).first
    const extraTax = taxable.tax - exempt.tax
    expect(extraTax).toBeGreaterThan(50000)
    expect(total(exempt.balancesEnd) - total(taxable.balancesEnd)).toBeCloseTo(extraTax, -1)
  })

  it('stops a windfall when its owner has died', () => {
    const { rows } = run(plan({
      people: [person(60, 62, { lifeExpectancy: 61 }), spouse(40, 65)],
      incomes: [{ id: 'w', ownerId: 'a', kind: 'windfall', amount: 100000, frequency: 'oneTime', taxTreatment: 'nonTaxable', from: { kind: 'year', year: YEAR + 3 }, growth: { kind: 'none' } }],
    }))
    expect(rows[3].deposits).toBe(0)
  })
})

describe('funding tolerance', () => {
  it('does not hide a $500 gap behind a large withdrawal', () => {
    const row = { shortfall: 500, withdrawal: 100000, cpi: 1 } as Parameters<typeof yearFellShort>[0]
    expect(yearFellShort(row)).toBe(true)
  })
})

describe('2026 tax figures and order of calculation', () => {
  it('applies the Ontario dividend credit after surtax (ON428 lines 69–70)', () => {
    const r = computeIncomeTax({ ...emptyIncome('ON', 40), otherOrdinary: 100000, eligibleDividends: 50000 })
    expect(r.provincial).toBeCloseTo(11874.62, 2)
  })

  it('uses the $690 BC tax reduction (Bill 2, s. 38)', () => {
    expect(computeIncomeTax({ ...emptyIncome('BC', 40), otherOrdinary: 30000 }).provincial).toBeCloseTo(407.61, 2)
  })

  it('uses the Q4 2026 OAS run rate of $762.50 a month', () => {
    expect(TAX_2026.oas.maxAt65).toBe(9150)
  })

  it('uses the 2026 Newfoundland basic amount', () => {
    // 44,678 × 8.7% + 5,322 × 14.5% − 13,094 × 8.7%
    expect(computeIncomeTax({ ...emptyIncome('NL', 40), otherOrdinary: 50000 }).provincial).toBeCloseTo(3519.50, 1)
  })
})

describe('rules that change by year', () => {
  const inflation = new Float64Array(8).fill(0.02)
  const cpi = cumulativeCpi(inflation, 8)
  const scale = (p: ProvinceCode) => provinceRealValues(TAX_2026.provinces[p], 2026, cpi, inflation)

  it('keeps fully indexed provinces at full real value', () => {
    const on = scale('ON')
    expect(on[5].brackets).toBeCloseTo(1, 10)
    expect(on[5].credits).toBeCloseTo(1, 10)
  })

  it('erodes permanently frozen provinces', () => {
    expect(scale('MB')[3].brackets).toBeCloseTo(1 / 1.02 ** 3, 10)
    expect(scale('PE')[3].credits).toBeCloseTo(1 / 1.02 ** 3, 10)
  })

  it('freezes BC for 2027–2030, then resumes indexing', () => {
    const bc = scale('BC')
    expect(bc[4].brackets).toBeCloseTo(1 / 1.02 ** 4, 10) // 2030
    expect(bc[5].brackets).toBeCloseTo(1.02 / 1.02 ** 5, 10) // 2031
    expect(bc[7].credits).toBeCloseTo(1.02 ** 3 / 1.02 ** 7, 10) // 2033
  })

  it('sets Newfoundland to $15,000 in 2027, then indexes it', () => {
    const nl = scale('NL')
    expect(nl[0].basicPersonal).toBeCloseTo(1, 10)
    expect(nl[1].basicPersonal * 13094 * 1.02).toBeCloseTo(15000, 6)
    expect(nl[2].basicPersonal * 13094 * 1.02 ** 2).toBeCloseTo(15000 * 1.02, 6)
  })

  it('adds Saskatchewan\'s $500 steps on top of indexation through 2028', () => {
    const sk = scale('SK')
    const after2027 = 20381 * 1.02 + 500
    const after2028 = after2027 * 1.02 + 500
    expect(sk[1].basicPersonal * 20381 * 1.02).toBeCloseTo(after2027, 6)
    expect(sk[2].basicPersonal * 20381 * 1.02 ** 2).toBeCloseTo(after2028, 6)
    expect(sk[3].basicPersonal * 20381 * 1.02 ** 3).toBeCloseTo(after2028 * 1.02, 6)
  })

  it('lets fixed pension credits lose value, except Ontario\'s and Alberta\'s', () => {
    expect(scale('BC')[2].pension).toBeCloseTo(1 / 1.02 ** 2, 10)
    expect(scale('ON')[2].pension).toBeCloseTo(1, 10)
    expect(scale('AB')[2].pension).toBeCloseTo(1, 10)
    const pensioner = { ...emptyIncome('ON', 70), pension: 50000 }
    expect(computeIncomeTax(pensioner, { deflator: 0.5 }).federal).toBeCloseTo(computeIncomeTax(pensioner).federal + 1000 * 0.14, 2)
  })
})

describe('LIF maximums (Empire Life 2026 table, age at January 1)', () => {
  const common: Record<number, number> = {
    50: 6.27, 51: 6.31, 52: 6.35, 53: 6.40, 54: 6.45, 55: 6.51, 56: 6.57, 57: 6.63, 58: 6.70, 59: 6.77, 60: 6.85, 61: 6.94, 62: 7.04, 63: 7.14, 64: 7.26,
    65: 7.38, 66: 7.52, 67: 7.67, 68: 7.83, 69: 8.02, 70: 8.22, 71: 8.45, 72: 8.71, 73: 9.00, 74: 9.34, 75: 9.71, 76: 10.15, 77: 10.66, 78: 11.25, 79: 11.96,
    80: 12.82, 81: 13.87, 82: 15.19, 83: 16.90, 84: 19.19, 85: 22.40, 86: 27.23, 87: 35.29, 88: 51.46, 89: 100, 90: 100, 95: 100,
  }
  const manitobaNovaScotia: Record<number, number> = {
    50: 6.10, 54: 6.10, 55: 6.40, 56: 6.50, 57: 6.50, 58: 6.60, 59: 6.70, 60: 6.70, 61: 6.80, 62: 6.90, 63: 7.00, 64: 7.10, 65: 7.20, 66: 7.30, 67: 7.40, 68: 7.60, 69: 7.70,
    70: 7.90, 71: 8.10, 72: 8.30, 73: 8.50, 74: 8.80, 75: 9.10, 76: 9.40, 77: 9.80, 78: 10.30, 79: 10.80, 80: 11.50, 81: 12.10, 82: 12.90, 83: 13.80, 84: 14.80, 85: 16.00, 86: 17.30, 87: 18.90, 88: 20, 95: 20,
  }
  const federal: Record<number, number> = {
    50: 4.99, 51: 5.03, 52: 5.07, 53: 5.11, 54: 5.16, 55: 5.21, 56: 5.26, 57: 5.32, 58: 5.39, 59: 5.46, 60: 5.53, 61: 5.61, 62: 5.70, 63: 5.80, 64: 5.91,
    65: 6.03, 66: 6.16, 67: 6.30, 68: 6.47, 69: 6.65, 70: 6.85, 71: 7.08, 72: 7.34, 73: 7.64, 74: 7.98, 75: 8.38, 76: 8.84, 77: 9.37, 78: 9.99, 79: 10.73,
    80: 11.61, 81: 12.70, 82: 14.05, 83: 15.80, 84: 18.13, 85: 21.40, 86: 26.30, 87: 34.48, 88: 50.86, 89: 100, 95: 100,
  }
  const check = (table: Record<number, number>, jurisdiction: 'ON' | 'MB' | 'NS' | 'FED') => {
    for (const [age, pct] of Object.entries(table)) expect(lifMaximumFactor(Number(age), jurisdiction) * 100, `${jurisdiction} at ${age}`).toBeCloseTo(pct, 2)
  }
  it('matches the common column', () => check(common, 'ON'))
  it('matches Manitoba and Nova Scotia', () => { check(manitobaNovaScotia, 'MB'); check(manitobaNovaScotia, 'NS') })
  it('matches the federal column', () => check(federal, 'FED'))

  const lira = (extra: Partial<PlanV2Input> = {}) => plan({
    people: [person(60, 55)],
    accounts: [{ id: 'l', type: 'LIRA', ownerId: 'a', balance: 100000 }],
    expenses: budget(1000), drawdown: EXPENSES, ...extra,
  })

  it('treats a LIRA as a LIF from the year it first pays, with minimums the next year', () => {
    const { rows } = run(lira())
    expect(rows[0].people[0].minimumWithdrawals).toBe(0)
    expect(rows[0].withdrawal).toBeCloseTo(1000, 0)
    // Balance 99,000, age 60 on January 1 of the second year: 1 / (90 − 60).
    expect(rows[1].people[0].minimumWithdrawals).toBeCloseTo(99000 / 30, 1)
  })
})

describe('contribution room', () => {
  const salary = { id: 'j', ownerId: 'a', kind: 'employment' as const, amount: 100000, growth: { kind: 'none' as const } }
  const rrsp = (amount: number) => ({ id: 'r', type: 'RRSP' as const, ownerId: 'a', balance: 0, contributions: [{ amount }] })

  it('gives no deduction with known-zero room and moves the money to non-registered', () => {
    const noContribution = run(plan({ people: [person(40, 65, { room: { rrsp: 0 } })], incomes: [salary], accounts: [rrsp(0)] })).first
    const { first } = run(plan({ people: [person(40, 65, { room: { rrsp: 0 } })], incomes: [salary], accounts: [rrsp(10000)] }))
    expect(first.tax).toBeCloseTo(noContribution.tax, 2)
    expect(first.balancesEnd[0]).toBe(0)
    expect(first.excessContributions).toBe(10000)
    expect(first.balancesEnd.reduce((s, b) => s + b, 0)).toBeCloseTo(10000, 2)
  })

  it('caps untracked room at this year\'s estimate: 18% of earnings', () => {
    const { first } = run(plan({ people: [person(40, 65)], incomes: [salary], accounts: [rrsp(20000)] }))
    expect(first.balancesEnd[0]).toBeCloseTo(18000, 2)
    expect(first.excessContributions).toBeCloseTo(2000, 2)
  })

  it('uses real room in place of the estimate', () => {
    const { first } = run(plan({ people: [person(40, 65, { room: { rrsp: 50000 } })], incomes: [salary], accounts: [rrsp(20000)] }))
    expect(first.balancesEnd[0]).toBeCloseTo(20000, 2)
    expect(first.excessContributions).toBe(0)
  })

  it('takes a pension adjustment off the next year\'s new room', () => {
    const { rows } = run(plan({ people: [person(40, 65, { room: { rrsp: 0 }, pensionAdjustment: 5000 })], incomes: [salary], accounts: [rrsp(20000)] }))
    // 18% × $100,000 − $5,000 of new room in the second year.
    expect(rows[1].balancesEnd[0]).toBeCloseTo(13000, 2)
  })

  it('caps a tracked TFSA at its room', () => {
    const { first } = run(plan({
      people: [person(40, 65, { room: { tfsa: 1000 } })], incomes: [salary],
      accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 0, contributions: [{ amount: 7000 }] }],
    }))
    expect(first.balancesEnd[0]).toBeCloseTo(1000, 2)
    expect(first.excessContributions).toBeCloseTo(6000, 2)
  })
})

describe('capital losses, distributions and the final return', () => {
  const lossPlan = (acb: number, windfall = 0) => plan({
    people: [person(70, 65)],
    accounts: [{ id: 'n', type: 'NONREG', ownerId: 'a', balance: 100000, acb }],
    // The non-taxable income pays the second year's tax, so nothing has to be sold.
    incomes: windfall > 0 ? [
      { id: 'w', ownerId: 'a', kind: 'windfall', amount: windfall, frequency: 'oneTime', from: { kind: 'year', year: YEAR + 1 }, taxTreatment: 'capitalGain', growth: { kind: 'none' } },
      { id: 'i', ownerId: 'a', kind: 'other', amount: windfall, from: { kind: 'year', year: YEAR + 1 }, taxTreatment: 'nonTaxable', growth: { kind: 'none' } },
    ] : [],
    expenses: { mode: 'detailed', items: [{ id: 'e', amount: 10000, to: { kind: 'year', year: YEAR + 1 } }] },
    drawdown: EXPENSES,
  })

  it('reports a realized loss and removes the cost base in proportion', () => {
    const { first } = run(lossPlan(200000))
    expect(first.withdrawal).toBeCloseTo(10000, 0)
    expect(first.realizedGains).toBeCloseTo(-10000, 0)
    expect(first.tax).toBe(0)
  })

  it('carries a net loss forward against later gains', () => {
    const noLoss = run(lossPlan(100000, 100000)).rows[1]
    const withLoss = run(lossPlan(200000, 100000)).rows[1]
    // A $10,000 loss removes $5,000 of the next year's taxable capital gain.
    expect(noLoss.people[0].taxableIncome - withLoss.people[0].taxableIncome).toBeCloseTo(5000, 0)
  })

  it('earns no distributions on money already withdrawn', () => {
    const p = (amount: number) => plan({
      people: [person(70, 65)],
      accounts: [{ id: 'n', type: 'NONREG', ownerId: 'a', balance: 100000, yields: { interestPct: 10 } }],
      expenses: budget(amount), drawdown: EXPENSES,
    })
    expect(run(p(50000)).first.investmentIncome).toBeCloseTo(5000, 0)
    expect(run(p(100000)).first.investmentIncome).toBeLessThan(1)
  })

  it('keeps the real income detail on the final return', () => {
    const { result } = run(plan({
      people: [person(65, 65, { lifeExpectancy: 65, oas: { startAge: 65, yearsInCanadaAfter18: 40 } })],
      accounts: [{ id: 'r', type: 'RRSP', ownerId: 'a', balance: 1000000 }],
      drawdown: { strategy: { kind: 'initialPct', ratePct: 4 } },
    }))
    // Worked out independently: Ontario, $40,000 RRSP plus $9,150 OAS, with
    // $960,000 deemed on top, including full OAS recovery. ($494,215.35 with
    // the $9,024 OAS figure the audit used.)
    expect(result.estate!.finalReturnTax).toBeCloseTo(494313.75, 1)
  })

  it('charges probate on the estate before income tax', () => {
    const { result } = run(plan({
      people: [person(65, 65, { lifeExpectancy: 65 })],
      accounts: [{ id: 'r', type: 'RRSP', ownerId: 'a', balance: 1000000 }],
      drawdown: { strategy: { kind: 'initialPct', ratePct: 4 } },
    }))
    // Ontario: 1.5% over $50,000.
    expect(result.estate!.probate).toBeCloseTo((result.estate!.grossEstate - 50000) * 0.015, 2)
  })
})

describe('one verdict', () => {
  const total = (values: number[]) => values.reduce((s, v) => s + v, 0)
  const salary = { id: 'j', ownerId: 'a', kind: 'employment' as const, amount: 100000, to: { kind: 'retirement' as const, personId: 'a' }, growth: { kind: 'none' as const } }
  const planWithSalary = (age: number) => plan({ people: [person(age, 65)], incomes: [salary] })
  const FOUR_PCT = { strategy: { kind: 'initialPct' as const, ratePct: 4 } }

  it('counts a salary ending within a year in the income target', () => {
    expect(compilePlan(planWithSalary(64), { startYear: YEAR }).simpleSpendingTarget).toBe(70000)
    // One year of inflation deflates a flat salary: 70% of $100,000 ÷ 1.025.
    expect(compilePlan(planWithSalary(63), { startYear: YEAR }).simpleSpendingTarget).toBeCloseTo(70000 / 1.025, 6)
  })

  it('leaves one-time income out of the target', () => {
    const c = compilePlan(plan({ people: [person(64, 65)], incomes: [{ ...salary, frequency: 'oneTime', to: undefined }] }), { startYear: YEAR })
    expect(c.simpleSpendingTarget).toBe(0)
  })

  it('takes an entered income target instead of the percentage', () => {
    const c = compilePlan(plan({ people: [person(70, 65)], expenses: { mode: 'simple', incomeTarget: 50000 } }), { startYear: YEAR })
    expect(c.simpleSpendingTarget).toBe(50000)
  })

  it('tests a fixed rate against the income target, not the withdrawal', () => {
    const p = (balance: number) => plan({
      people: [person(70, 65)], accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance }],
      expenses: { mode: 'simple', incomeTarget: 40000 }, drawdown: FOUR_PCT,
    })
    // 4% of $120,000 is $4,800 against a $40,000 target.
    const { first, result } = run(p(120000))
    expect(first.withdrawal).toBe(4800)
    expect(first.shortfall).toBeCloseTo(35200, 2)
    expect(runSucceeded(result)).toBe(false)
    expect(run(p(1000000)).first.shortfall).toBe(0)
  })

  it('keeps the withdrawal test for flexible strategies', () => {
    const { first } = run(plan({
      people: [person(70, 65)], accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 120000 }],
      expenses: { mode: 'simple', incomeTarget: 40000 }, drawdown: { strategy: { kind: 'pctPortfolio', ratePct: 4 } },
    }))
    expect(first.shortfall).toBe(0)
  })

  it('asks for a target instead of calling a plan on track with nothing to test', () => {
    const p = plan({ people: [person(70, 65)], accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 100000 }], drawdown: FOUR_PCT })
    const { c, result } = run(p)
    const { outlook, funding } = planGoalOutlook(p, c, result, YEAR)
    expect(funding.needsTarget).toBe(true)
    expect(outlook.needsTarget).toBe(true)
    expect(outlook.onTrack).toBe(false)
  })

  it('reads a LIF-limited plan as short with money left over', () => {
    const p = plan({
      people: [person(60, 55, { lifeExpectancy: 75 })],
      accounts: [{ id: 'l', type: 'LIF', ownerId: 'a', balance: 1000000 }],
      expenses: budget(90000), drawdown: EXPENSES,
    })
    const { c, result } = run(p)
    const funding = evaluateFunding(c, result)
    expect(funding.funded).toBe(false)
    expect(funding.firstShortfall?.offset).toBe(0)
    expect(funding.cause).toBe('limits')
    expect(funding.depletion).toBeNull()
    expect(moneyLasts(p, c, result).wholePlan).toBe(false)
    expect(moneyLasts(p, c, result).note).toContain('limits')
  })

  it('does not count ending a fully funded final year at zero as running out', () => {
    const { c, result, rows } = run(plan({
      people: [person(70, 65, { lifeExpectancy: 71, cpp: { mode: 'amount', amountAt65: 0 }, oas: { startAge: 65, yearsInCanadaAfter18: 0 } })],
      accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 60000 }],
      expenses: budget(30000), drawdown: EXPENSES,
    }))
    expect(rows.at(-1)!.balancesEnd[0]).toBeCloseTo(0, 0)
    const funding = evaluateFunding(c, result)
    expect(funding.funded).toBe(true)
    expect(funding.depletion).toBeNull()
  })

  it('reports savings running out apart from funding when income carries on', () => {
    const { c, result, rows } = run(plan({
      people: [person(70, 65, { lifeExpectancy: 73, cpp: { mode: 'amount', amountAt65: 0 }, oas: { startAge: 65, yearsInCanadaAfter18: 0 } })],
      accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 10000 }],
      incomes: [{ id: 'i', ownerId: 'a', kind: 'other', amount: 30000, taxTreatment: 'nonTaxable', from: { kind: 'year', year: YEAR + 1 }, growth: { kind: 'none' } }],
      expenses: budget(10000), drawdown: EXPENSES,
    }))
    expect(rows[0].shortfall).toBe(0)
    const funding = evaluateFunding(c, result)
    expect(funding.funded).toBe(true)
    expect(funding.depletion?.offset).toBe(0)
  })

  it('gives one verdict across the headline, comparison and simulation', () => {
    const fixtures = [
      plan({ people: [person(70, 65)], accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 2000000 }], expenses: budget(30000), drawdown: EXPENSES }),
      plan({ people: [person(70, 65)], accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 10000 }], expenses: budget(90000), drawdown: EXPENSES }),
    ]
    for (const p of fixtures) {
      const { c, result } = run(p)
      const { outlook, funding } = planGoalOutlook(p, c, result, YEAR)
      expect(outlook.onTrack).toBe(funding.funded)
      expect(planMetrics(p, c, result).onTrack).toBe(funding.funded)
      expect(runSucceeded(result)).toBe(funding.funded)
      expect(moneyLasts(p, c, result).wholePlan).toBe(funding.funded)
    }
  })

  it('finds no safe age when the last one fails, and never skips a failure', () => {
    const safe = (...flags: boolean[]) => findSafestIndex(flags.map(s => ({ safe: s })))
    expect(safe(true, true, false)).toBeNull()
    expect(safe(false, true, true)).toBe(1)
    expect(safe(true, false, true)).toBe(2)
    expect(safe(true, true, true)).toBe(0)
  })

  it('does not call a zero change an improvement', () => {
    const score: PlanScore = { successRate: null, onTrack: true, funded: true, goalProgressPct: 100, lifetimeTax: 0, afterTaxEstate: 0, averageIncome: 0, spending: 0 }
    expect(isImprovement(score, score)).toBe(false)
    expect(isImprovement({ ...score, averageIncome: 100 }, { ...score, averageIncome: 100 })).toBe(false)
    expect(isImprovement({ ...score, averageIncome: 100 }, { ...score, averageIncome: 102 })).toBe(true)
  })

  describe('savings guideline', () => {
    const required = (over: Partial<PlanV2Input>) => {
      const p = plan({
        people: [person(70, 65, { cpp: { mode: 'amount', amountAt65: 0 }, oas: { startAge: 65, yearsInCanadaAfter18: 0 } })],
        accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 2000000 }],
        expenses: budget(40000), drawdown: FOUR_PCT, ...over,
      })
      const { c, result } = run(p)
      return planGoalOutlook(p, c, result, YEAR).goal
    }

    it('reserves a one-time cost once instead of capitalizing it', () => {
      const roof = { mode: 'detailed' as const, items: [{ id: 'e', amount: 40000 }, { id: 'r', amount: 50000, frequency: 'oneTime' as const, from: { kind: 'now' as const } }] }
      expect(required({ expenses: roof }).requiredPortfolio - required({}).requiredPortfolio).toBeCloseTo(50000, 2)
    })

    it('annualizes a cost every few years', () => {
      const car = { mode: 'detailed' as const, items: [{ id: 'e', amount: 40000 }, { id: 'c', amount: 20000, frequency: 'everyNYears' as const, everyNYears: 5 }] }
      // $4,000 a year at a 4% withdrawal rate.
      expect(required({ expenses: car }).requiredPortfolio - required({}).requiredPortfolio).toBeCloseTo(100000, 2)
    })

    it('counts a debt once, as the balance owed', () => {
      const debts = [{ id: 'l', balance: 20000, interestRatePct: 0, monthlyPayment: 1000 }]
      expect(required({ debts }).requiredPortfolio - required({}).requiredPortfolio).toBeCloseTo(20000, 2)
    })

    it('gives the same saving figure in both dollar modes', () => {
      const p = plan({ people: [person(40, 65)], incomes: [salary], assumptions: { expectedReturn: 5, inflationRate: 2 }, drawdown: FOUR_PCT })
      const { c, result } = run(p, 5, 2)
      const real = planGoalOutlook(p, c, result, YEAR, true)
      const nominal = planGoalOutlook(p, c, result, YEAR, false)
      expect(real.outlook.onTrack).toBe(nominal.outlook.onTrack)
      expect(nominal.goal.additionalAnnualSavings).toBeCloseTo(real.goal.additionalAnnualSavings, -1)
    })

    it('stays finite at zero and negative real returns', () => {
      const goalAt = (expectedReturn: number) => {
        const p = plan({ people: [person(40, 65)], incomes: [salary], assumptions: { expectedReturn, inflationRate: 2 }, drawdown: FOUR_PCT })
        const { c, result } = run(p, expectedReturn, 2)
        return planGoalOutlook(p, c, result, YEAR).goal.additionalAnnualSavings
      }
      expect(Number.isFinite(goalAt(2))).toBe(true)
      expect(goalAt(0)).toBeGreaterThan(goalAt(2))
    })
  })

  describe('displays', () => {
    it('moves stocks in the conservative and optimistic cases', () => {
      const p = plan({ people: [person(40, 65)], accounts: [{ id: 's', type: 'STOCK', ownerId: 'a', balance: 0, holdings: [{ id: 'h', symbol: 'X', shares: 1000, priceUsd: 100, growthPct: { base: 5 } }] }], assumptions: { usdCad: { rate: 1 } } })
      const c = compilePlan(p, { startYear: YEAR })
      const endOfFirstYear = (shift: number) => simulate(c, shiftedDeterministicPath(c, 5 + shift, 0, shift)).rows[0].balancesEnd[0]
      expect(endOfFirstYear(-2)).toBeCloseTo(103000, 0)
      expect(endOfFirstYear(2)).toBeCloseTo(107000, 0)
    })

    it('reconciles contributions and growth, including losses and deposits', () => {
      const p = plan({
        people: [person(40, 43)],
        accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 10000, contributions: [{ amount: 1000 }] }],
        incomes: [{ id: 'w', ownerId: 'a', kind: 'windfall', amount: 5000, frequency: 'oneTime', taxTreatment: 'nonTaxable', from: { kind: 'year', year: YEAR + 1 }, growth: { kind: 'none' } }],
      })
      const c = compilePlan(p, { startYear: YEAR })
      const rows = simulate(c, deterministicPath(c.years, -10, 0)).rows.slice(0, 4)
      const points = buildContributionGrowth(rows, 40, false)
      points.forEach((pt, i) => expect(pt.contributions + pt.growth).toBeCloseTo(total(rows[i].balancesStart), 2))
      // Year 1: $10,000 opening + $1,000; year 2 adds $1,000 + the $5,000 windfall.
      expect(points[1].contributions).toBeCloseTo(11000, 2)
      expect(points[2].contributions).toBeCloseTo(17000, 2)
      expect(points[3].growth).toBeLessThan(0)
    })

    it('keeps spending levels at or above commitments, with every item non-negative', () => {
      const p = plan({
        people: [person(70, 65)],
        accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 500000 }],
        debts: [{ id: 'l', balance: 12000, interestRatePct: 0, monthlyPayment: 1000 }],
        expenses: budget(8000), drawdown: EXPENSES,
      })
      const c = compilePlan(p, { startYear: YEAR })
      const levels = buildSpendingLevels(c, 0, true)!
      // $12,000 of debt payments can't be scaled away.
      for (const level of levels.levels) expect(level.spending).toBeGreaterThanOrEqual(12000)
    })

    it('stops ESPP and saved surplus when testing Coast FI', () => {
      const p = plan({
        people: [person(40, 65)],
        accounts: [{ id: 's', type: 'STOCK', ownerId: 'a', balance: 0, holdings: [{ id: 'h', symbol: 'X', shares: 1, priceUsd: 1, espp: { annualContribution: 1000 } }] }],
        expenses: { mode: 'detailed', surplusPolicy: 'save', items: [] },
      })
      const stopped = withContributionsStoppingIn(p, 2030, YEAR)
      expect(stopped.expenses.surplusPolicy).toBe('ignore')
      const stock = stopped.accounts[0]
      expect(stock.type === 'STOCK' && stock.holdings[0].espp?.to).toEqual({ kind: 'year', year: 2030 })
    })

    it('uses the engine\'s after-tax income, payroll included', () => {
      const { c, result, first } = run(plan({
        people: [person(65, 60)],
        incomes: [{ id: 'j', ownerId: 'a', kind: 'employment', amount: 50000, growth: { kind: 'none' } }],
        accounts: [{ id: 'r', type: 'RRIF', ownerId: 'a', balance: 100000 }],
        expenses: budget(30000), drawdown: EXPENSES,
      }))
      expect(first.people[0].payroll).toBeGreaterThan(1000)
      expect(buildRetirementTaxSnapshot(c, result, false)!.afterTaxIncome).toBeCloseTo(first.afterTaxIncome, 6)
    })
  })
})

describe('a partial first year', () => {
  // Days left from November 9, 2026 to January 1: 22 in November + 31 in December.
  const F = 53 / 365
  const noBenefits = { cpp: { mode: 'amount' as const, amountAt65: 0 }, oas: { startAge: 65, yearsInCanadaAfter18: 0 } }
  const partial = (o: Partial<PlanV2Input> & Pick<PlanV2Input, 'people'>) => plan({ asOf: '2026-11-09', ...o })
  const runPartial = (p: PlanV2, returnPct = 0, inflationPct = 0) => {
    const c = compilePlan(p, { startYear: YEAR })
    const result = simulate(c, planPath(c, returnPct, inflationPct))
    return { c, result, rows: result.rows, first: result.rows[0] }
  }
  const salary = { id: 'j', ownerId: 'a', kind: 'employment' as const, amount: 100000, growth: { kind: 'none' as const } }

  it('counts days from the balance date, without a time zone', () => {
    expect(firstPeriodFraction('2026-11-09', 2026)).toBeCloseTo(F, 12)
    expect(firstPeriodFraction('2026-01-01', 2026)).toBe(1)
    expect(firstPeriodFraction('2028-03-01', 2028)).toBeCloseTo(306 / 366, 12) // leap year
    expect(firstPeriodFraction('2025-06-01', 2026)).toBe(1)
  })

  it('leaves v1 rules on a full year', () => {
    expect(compilePlan(partial({ people: [person(40, 65)] }), { startYear: YEAR, rules: 'v1' }).firstPeriodFraction).toBe(1)
  })

  it('reproduces a full year from January 1', () => {
    const p = plan({ people: [person(40, 65)], accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 100000 }] })
    const c = compilePlan(p, { startYear: YEAR })
    expect(simulate(c, planPath(c, 7, 2.5)).rows[0].balancesEnd[0]).toBeCloseTo(107000, 6)
  })

  it('prorates growth, income, spending, saving and yields, but not one-time events', () => {
    const p = partial({
      people: [person(40, 65, noBenefits)],
      incomes: [salary, { id: 'w', ownerId: 'a', kind: 'windfall', amount: 10000, frequency: 'oneTime', taxTreatment: 'nonTaxable', growth: { kind: 'none' } }],
      accounts: [
        { id: 't', type: 'TFSA', ownerId: 'a', balance: 100000, contributions: [{ amount: 7000 }] },
        { id: 'n', type: 'NONREG', ownerId: 'a', balance: 100000, yields: { interestPct: 2 } },
      ],
      properties: [{ id: 'h', ownerId: 'a', value: 500000, annualCosts: 5000 }],
      expenses: { mode: 'detailed', surplusPolicy: 'ignore', items: [{ id: 'e', amount: 40000 }, { id: 'r', amount: 3000, frequency: 'oneTime', from: { kind: 'now' } }] },
    })
    const { first } = runPartial(p, 6, 2)
    expect(first.periodFraction).toBeCloseTo(F, 12)
    expect(first.people[0].employment).toBeCloseTo(100000 * F, 2)
    expect(first.spending).toBeCloseTo((40000 + 5000) * F + 3000, 2)
    expect(first.contributions).toBeCloseTo(7000 * F, 2)
    expect(first.deposits).toBe(10000)
    // The windfall is invested at the start of the period, so it earns too.
    expect(first.investmentIncome).toBeCloseTo(110000 * 0.02 * F, 1)
    expect(first.cpiEnd).toBeCloseTo(Math.pow(1.02, F), 10)
  })

  it('grows balances for the part of the year left', () => {
    const { first } = runPartial(partial({ people: [person(70, 65, noBenefits)], accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 100000 }], drawdown: { strategy: { kind: 'initialPct', ratePct: 0.01 } } }), 8, 0)
    expect(first.balancesEnd[0] / (100000 - 10 * F)).toBeCloseTo(Math.pow(1.08, F), 8)
  })

  it('prorates CPP, OAS and RRIF minimums', () => {
    const { first } = runPartial(partial({
      people: [person(75, 65, { cpp: { mode: 'amount', amountAt65: 12000 }, oas: { startAge: 65, yearsInCanadaAfter18: 40 } })],
      accounts: [{ id: 'r', type: 'RRIF', ownerId: 'a', balance: 100000 }],
      drawdown: { strategy: { kind: 'initialPct', ratePct: 0.01 } },
    }))
    expect(first.people[0].cpp).toBeCloseTo(12000 * F, 2)
    expect(first.people[0].oas).toBeCloseTo(9150 * 1.1 * F, 2)
    // Age 74 on January 1: 5.67%.
    expect(first.people[0].minimumWithdrawals).toBeCloseTo(100000 * 0.0567 * F, 2)
  })

  it('makes debt payments for the months remaining', () => {
    const { first } = runPartial(partial({
      people: [person(40, 65, noBenefits)], incomes: [salary],
      debts: [{ id: 'l', balance: 10000, interestRatePct: 0, monthlyPayment: 500 }],
      expenses: budget(0),
    }))
    // Round(0.145 × 12) = 2 monthly payments.
    expect(first.debtPayments).toBeCloseTo(1000, 2)
    expect(first.debtBalance).toBeCloseTo(9000, 2)
  })

  const taxOn = (income: number, oneTime = 0) => computeIncomeTax({ ...emptyIncome('ON', 40), otherOrdinary: income + oneTime })

  it('charges the steady share of the year\'s tax on recurring income', () => {
    const { first } = runPartial(partial({ people: [person(40, 65, noBenefits)], incomes: [{ id: 'j', ownerId: 'a', kind: 'other', amount: 80000, growth: { kind: 'none' } }] }))
    expect(first.tax).toBeCloseTo(taxOn(80000).total * F, 1)
  })

  it('taxes a one-time receipt on top of the full year, as T(R+O) − (1−f)T(R)', () => {
    const { first } = runPartial(partial({
      people: [person(40, 65, noBenefits)],
      incomes: [
        { id: 'j', ownerId: 'a', kind: 'other', amount: 80000, growth: { kind: 'none' } },
        { id: 'w', ownerId: 'a', kind: 'other', amount: 30000, frequency: 'oneTime', growth: { kind: 'none' } },
      ],
    }))
    expect(first.tax).toBeCloseTo(taxOn(80000, 30000).total - (1 - F) * taxOn(80000).total, 1)
  })

  it('starts a fixed withdrawal at the period\'s share and the next year in full', () => {
    const { rows } = runPartial(partial({
      people: [person(70, 65, noBenefits)], accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 100000 }],
      drawdown: { strategy: { kind: 'initialPct', ratePct: 4 } },
    }))
    expect(rows[0].withdrawal).toBeCloseTo(4000 * F, 2)
    expect(rows[1].withdrawal).toBeCloseTo(4000, 2)
  })

  it('scales a Monte Carlo first year: drift by f, shocks by the square root', () => {
    expect(lognormalReturn(0.08, 0, 0, F)).toBeCloseTo(Math.pow(1.08, F) - 1, 10)
    const sigma2 = Math.log(1 + 0.16 ** 2 / 1.08 ** 2)
    const mu = Math.log(1.08) - sigma2 / 2
    expect(lognormalReturn(0.08, 0.16, 1.5, F)).toBeCloseTo(Math.exp(mu * F + Math.sqrt(sigma2 * F) * 1.5) - 1, 10)
  })

  it('uses a share of a historical first year', () => {
    const c = compilePlan(partial({ people: [person(40, 65)] }), { startYear: YEAR })
    const data = [{ year: 2000, equity: 0.2, bond: 0.05, cash: 0.02, inflation: 0.03 }]
    const path = historicalPath(c, 0, { equity: 100, bond: 0, cash: 0 }, data)
    expect(path.nominalReturn[0]).toBeCloseTo(Math.pow(1.2, F) - 1, 10)
    expect(path.nominalReturn[1]).toBeCloseTo(0.2, 10)
    expect(path.inflation[0]).toBeCloseTo(Math.pow(1.03, F) - 1, 10)
  })

  it('uses the first full year for headline figures of a plan already retired', () => {
    const p = partial({
      people: [person(70, 65, { cpp: { mode: 'amount', amountAt65: 12000 } })],
      accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 500000 }],
      expenses: { mode: 'simple', incomeTarget: 40000 }, drawdown: EXPENSES,
    })
    const { c, result, rows } = runPartial(p)
    expect(c.headlineOffset).toBe(1)
    expect(retirementSpendingTarget(c, result)).toBeCloseTo(rows[1].spending / rows[1].cpi, 6)
    expect(rows[1].spending).toBeCloseTo(40000, 2)
    expect(buildRetirementTaxSnapshot(c, result, false)!.preTaxIncome).toBeCloseTo(rows[1].grossIncome, 6)
  })

  it('weights the first year by its length in averages', () => {
    const p = partial({
      people: [person(70, 65, noBenefits)],
      accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 2000000 }],
      expenses: budget(30000), drawdown: EXPENSES,
    })
    const { c, result } = runPartial(p)
    expect(planMetrics(p, c, result).averageRetirementIncome).toBeCloseTo(30000, 0)
  })

  it('marks the partial year in the table and warns about this year\'s one-time events', () => {
    const p = partial({
      people: [person(40, 65)],
      incomes: [{ id: 'w', ownerId: 'a', label: 'Bonus', kind: 'windfall', amount: 1, frequency: 'oneTime', from: { kind: 'now' }, growth: { kind: 'none' } }],
    })
    const { c, result } = runPartial(p)
    expect(buildYearTable(c, result, false)[0][0]).toBe('2026 (rest of year)')
    expect(diagnosePlan(p, NOW).map(d => d.message).join()).toContain('"Bonus" is dated 2026')
  })

  it('dates entries with the local calendar day', () => {
    expect(isoDate(new Date(2026, 11, 31, 23, 30))).toBe('2026-12-31')
  })

  it('moves the balance date when a balance changes', () => {
    const p = plan({ people: [person(40, 65)], accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 1 }] })
    const next = patchAccountBalance(p, 't', 2, '2026-11-09')
    expect(next.asOf).toBe('2026-11-09')
    expect(next.accounts[0].balance).toBe(2)
  })

  describe('tracking', () => {
    const p = partial({ people: [person(40, 65)], accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 100000 }] })

    it('shows no difference on the first snapshot', () => {
      const baseline = baselineFromPlan(p, YEAR, '2026-11-09', { date: '2026-11-09', value: 100000 })
      expect(baselineValueAt(baseline, '2026-11-09')).toBe(100000)
    })

    it('interpolates dated points by days', () => {
      const baseline = { planId: 'p', date: '2026-11-09', portfolio: [], points: [{ date: '2026-11-09', value: 100 }, { date: '2027-01-01', value: 153 }] }
      expect(baselineValueAt(baseline, '2026-12-01')).toBeCloseTo(100 + 53 * (22 / 53), 8)
      expect(baselineValueAt(baseline, '2027-06-01')).toBe(153)
    })

    it('keeps the old reading for baselines without dated points', () => {
      const legacy = { planId: 'p', date: '2026-01-01', portfolio: [{ year: 2026, value: 100 }, { year: 2027, value: 200 }] }
      // Six months at the old 30.4-day estimate: (5 × 30.4) / 365 of the way.
      expect(baselineValueAt(legacy, '2026-06-01')).toBeCloseTo(100 + 100 * (5 * 30.4) / 365, 6)
      expect(baselineValueAt(legacy, '2030-01-01')).toBeNull()
    })
  })
})

describe('rental income and survivors', () => {
  const rental = (propertyId?: string) => ({ id: 'r', ownerId: 'a', kind: 'rental' as const, amount: 12000, propertyId, growth: { kind: 'none' as const } })
  const rentalHome = { id: 'h', ownerId: 'a', value: 300000, isPrincipalResidence: false, acb: 300000, sale: { at: { kind: 'year' as const, year: YEAR + 2 }, sellingCostPct: 0 } }

  it('ends rental income when its property is sold', () => {
    const rows = run(plan({ people: [person(70, 65)], incomes: [rental('h')], properties: [rentalHome] })).rows
    expect(rows[1].otherIncome).toBe(12000)
    expect(rows[2].otherIncome).toBe(0)
  })

  it('leaves unlinked rental income on its own schedule', () => {
    const rows = run(plan({ people: [person(70, 65)], incomes: [rental()], properties: [rentalHome] })).rows
    expect(rows[2].otherIncome).toBe(12000)
  })

  it('scales spending items for a survivor, not debts or one-time costs', () => {
    const p = plan({
      people: [person(70, 65, { lifeExpectancy: 71 }), spouse(70, 65, { lifeExpectancy: 80 })],
      accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 2000000 }],
      debts: [{ id: 'l', balance: 100000, interestRatePct: 0, monthlyPayment: 1000 }],
      expenses: { mode: 'detailed', survivorSpendingPct: 70, items: [{ id: 'e', amount: 40000 }, { id: 'o', amount: 5000, frequency: 'oneTime', from: { kind: 'year', year: YEAR + 2 } }] },
      drawdown: EXPENSES,
    })
    const { rows } = run(p)
    expect(rows[0].spending).toBe(40000 + 12000)
    // After the death in 2028: 70% of $40,000, the $5,000 cost and the debt in full.
    expect(rows[2].spending).toBeCloseTo(28000 + 5000 + 12000, 2)
  })

  it('stays at 100% by default', () => {
    const p = plan({ people: [person(70, 65, { lifeExpectancy: 71 }), spouse(70, 65, { lifeExpectancy: 80 })], expenses: budget(40000) })
    expect(run(p).rows[3].spending).toBe(40000)
  })
})

describe('assumptions and risk', () => {
  it('gives new plans the agreed defaults, written explicitly', () => {
    const p = createDefaultPlan(new Date(2026, 0, 1))
    expect(p.assumptions.expectedReturn).toBe(4.5)
    expect(p.assumptions.inflationRate).toBe(2.5)
    expect(p.assumptions.assetReturns).toEqual({ equityPct: 6.3, bondPct: 3.2, cashPct: 2.4 })
    expect(p.drawdown.strategy).toEqual({ kind: 'expenses' })
  })

  it('leaves older plans on their saved assumptions', () => {
    const p = plan({ people: [person(40, 65)] })
    expect(p.assumptions.expectedReturn).toBe(7)
    expect(p.drawdown.strategy.kind).toBe('initialPct')
  })

  it('does not call either default return set custom', () => {
    const custom = (r: PlanV2['assumptions']['assetReturns']) => advancedSettingsInUse({ ...plan({ people: [person(40, 65)] }), assumptions: { ...plan({ people: [person(40, 65)] }).assumptions, assetReturns: r } }).map(x => x.label).join()
    expect(custom({ equityPct: 6.6, bondPct: 3.4, cashPct: 2.4 })).not.toContain('Asset')
    expect(custom({ equityPct: 6.3, bondPct: 3.2, cashPct: 2.4 })).not.toContain('Asset')
    expect(custom({ equityPct: 8, bondPct: 3.2, cashPct: 2.4 })).toContain('sset')
  })

  it('takes fees off asset-class returns and history, not off the expected return', () => {
    const p = plan({
      people: [person(40, 65)], assumptions: { expectedReturn: 5, feePct: 1, assetReturns: { equityPct: 6, bondPct: 3, cashPct: 2 } },
      accounts: [{ id: 'a', type: 'TFSA', ownerId: 'a', balance: 1, allocation: { equity: 100, bond: 0, cash: 0 } }, { id: 'b', type: 'TFSA', ownerId: 'a', balance: 1 }],
    })
    const c = compilePlan(p, { startYear: YEAR })
    expect(c.accounts[0].expectedReturnPct).toBe(5)
    expect(c.accounts[1].expectedReturnPct).toBe(5)
    expect(c.assetReturnsPct.equity).toBe(5)
    const data = [{ year: 2000, equity: 0.1, bond: 0.05, cash: 0.02, inflation: 0.03 }]
    expect(historicalPath(c, 0, { equity: 100, bond: 0, cash: 0 }, data).assets!.equity[0]).toBeCloseTo(0.09, 10)
  })

  it('gives new non-registered accounts an editable yield estimate', () => {
    const p = addAccount(plan({ people: [person(40, 65)] }), 'a', 'NONREG', 'n')
    const a = p.accounts[0]
    expect(a.type === 'NONREG' && (a.yields?.interestPct ?? 0) > 0).toBe(true)
  })

  it('flags an existing non-registered account with no yields', () => {
    const messages = diagnosePlan(plan({ people: [person(40, 65)], accounts: [{ id: 'n', type: 'NONREG', ownerId: 'a', balance: 1 }] }), NOW).map(d => d.message).join()
    expect(messages).toContain('no yearly distributions')
  })

  it('replays history from the first retirement year', () => {
    const c = compilePlan(plan({ people: [person(60, 62)] }), { startYear: YEAR })
    const data = [{ year: 2000, equity: 0.5, bond: 0.5, cash: 0.5, inflation: 0.1 }]
    const path = retirementAnchoredPath(c, 0, { equity: 100, bond: 0, cash: 0 }, data)
    expect(path.nominalReturn[0]).toBeCloseTo(c.expectedReturnPct / 100, 10)
    expect(path.nominalReturn[1]).toBeCloseTo(c.expectedReturnPct / 100, 10)
    expect(path.nominalReturn[2]).toBeCloseTo(0.5, 10)
  })

  it('stress-tests living 5 and 10 years longer', () => {
    const results = runCrashScenarios(plan({ people: [person(70, 65)], accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 100000 }], expenses: budget(5000), drawdown: EXPENSES }), YEAR)
    expect(results.map(r => r.id)).toEqual(expect.arrayContaining(['longevity-5', 'longevity-10']))
  })

  it('reports a 95% range on a success rate', () => {
    const range = successRange(90, 100)
    // Wilson interval for 90 of 100.
    expect(range.low).toBeCloseTo(0.8256, 3)
    expect(range.high).toBeCloseTo(0.9448, 3)
  })
})

describe('Canadian coverage', () => {
  const income = (id: string, ownerId: string, amount: number) => ({ id, ownerId, kind: 'other' as const, amount, growth: { kind: 'none' as const } })
  const withoutSpouse = (province: ProvinceCode) => computeHouseholdTax([{ ...emptyIncome(province, 40), otherOrdinary: 80000 }], {}).total

  it('gives the higher earner the federal and Ontario spouse amounts', () => {
    const household = computeHouseholdTax([{ ...emptyIncome('ON', 40), otherOrdinary: 80000 }, { ...emptyIncome('ON', 40), otherOrdinary: 5000 }], {})
    // Federal: (16,452 − 5,000) × 14% = 1,603.28.
    // Ontario: (11,029 − max(0, 5,000 − 1,103)) × 5.05% = 360.15, with no surtax at this income.
    expect(withoutSpouse('ON') - household.perPerson[0].total).toBeCloseTo(1603.28 + 360.15, 1)
  })

  it('gives no spouse amount once the spouse earns enough', () => {
    const household = computeHouseholdTax([{ ...emptyIncome('ON', 40), otherOrdinary: 80000 }, { ...emptyIncome('ON', 40), otherOrdinary: 60000 }], {})
    expect(household.perPerson[0].total).toBeCloseTo(withoutSpouse('ON'), 2)
  })

  it('has no Quebec spouse amount, but keeps the federal one', () => {
    const household = computeHouseholdTax([{ ...emptyIncome('QC', 40), otherOrdinary: 80000 }, { ...emptyIncome('QC', 40), otherOrdinary: 5000 }], {})
    // Federal (16,452 − 5,000) × 14% × (1 − 16.5% Quebec abatement) = 1,338.74,
    // plus the spouse's unused Quebec credit (line 431): 2,653.28 − 700 = 1,953.28.
    expect(withoutSpouse('QC') - household.perPerson[0].total).toBeCloseTo(1338.74 + 1953.28, 1)
  })

  it('gives a receiver under 65 no credit on split RRIF income', () => {
    const rrif = computeHouseholdTax([
      { ...emptyIncome('ON', 70), registeredWithdrawals: 60000 },
      { ...emptyIncome('ON', 60), otherOrdinary: 0 },
    ], { splitting: true })
    expect(rrif.splits[1]).toBeGreaterThan(0)
    const noCredit = computeIncomeTax({ ...emptyIncome('ON', 60), pensionSplit: rrif.splits[1], pensionSplitCreditable: 0 })
    expect(rrif.perPerson[1].total).toBeCloseTo(noCredit.total, 2)
  })

  it('counts a split of pension-plan income for a receiver under 65', () => {
    const pension = computeHouseholdTax([
      { ...emptyIncome('ON', 70), pension: 60000 },
      { ...emptyIncome('ON', 60), otherOrdinary: 0 },
    ], { splitting: true })
    const fullCredit = computeIncomeTax({ ...emptyIncome('ON', 60), pensionSplit: pension.splits[1] })
    expect(pension.perPerson[1].total).toBeCloseTo(fullCredit.total, 2)
  })

  const fhsa = (extra: object = {}) => ({ id: 'f', type: 'FHSA' as const, ownerId: 'a', balance: 10000, openedYear: YEAR, ...extra })

  it('closes an FHSA in its 15th year and rolls it into an RRSP', () => {
    const { rows, c } = run(plan({ people: [person(30, 65)], accounts: [fhsa()] }))
    const rrsp = c.accounts.findIndex(a => a.type === 'RRSP')
    expect(rows[14].balancesEnd[0]).toBe(10000)
    expect(rows[15].balancesEnd[0]).toBe(0)
    expect(rows[15].balancesEnd[rrsp]).toBe(10000)
    expect(rows[15].tax).toBe(0)
  })

  it('closes an FHSA the year its holder turns 71, if that comes first', () => {
    const { rows } = run(plan({ people: [person(69, 75)], accounts: [fhsa()] }))
    expect(rows[1].balancesEnd[0]).toBe(10000)
    expect(rows[2].balancesEnd[0]).toBe(0)
  })

  it('takes a qualifying withdrawal out tax-free and stops contributing', () => {
    const { rows } = run(plan({
      people: [person(30, 65)], incomes: [income('j', 'a', 80000)],
      accounts: [{ ...fhsa({ homePurchaseYear: YEAR + 2 }), contributions: [{ amount: 8000 }] }],
    }))
    // $10,000 plus two years at $8,000.
    expect(rows[2].homePurchaseWithdrawals).toBe(26000)
    expect(rows[2].withdrawal).toBe(0)
    expect(rows[2].balancesEnd[0]).toBe(0)
    expect(rows[3].contributions).toBe(0)
  })
})

// Quebec Schedules B, F and Q (TP-1.D, 2025-12): the 2025 forms' method, with
// the 2026 amounts in TAX_2026. Basic personal: 18,952 × 14% = 2,653.28.
describe('Quebec return', () => {
  const qc = (age: number, extra: object = {}) => ({ ...emptyIncome('QC', age), ...extra })
  const BASIC = 18952 * 0.14

  describe('Schedule F: health services fund', () => {
    it('charges 1% over $18,130, up to $150, on income up to $63,060', () => {
      // 30,000 × 14% − basic credit + 1% × 11,870.
      expect(computeIncomeTax(qc(40, { otherOrdinary: 30000 })).provincial).toBeCloseTo(30000 * 0.14 - BASIC + 118.7, 2)
      expect(computeIncomeTax(qc(40, { otherOrdinary: 18130 })).healthPremium).toBe(0)
      expect(computeIncomeTax(qc(40, { otherOrdinary: 60000 })).healthPremium).toBe(150)
    })

    it('charges $150 plus 1% over $63,060, up to $1,000', () => {
      expect(computeIncomeTax(qc(40, { otherOrdinary: 70000 })).healthPremium).toBeCloseTo(219.4, 2)
      expect(computeIncomeTax(qc(40, { otherOrdinary: 200000 })).healthPremium).toBe(1000)
    })

    it('leaves out employment income and the OAS pension', () => {
      expect(computeIncomeTax(qc(40, { employment: 100000 })).healthPremium).toBe(0)
      expect(computeIncomeTax(qc(70, { oas: 9150 })).healthPremium).toBe(0)
    })

    it('counts dividends at their actual amount, not grossed up', () => {
      // $20,000 received: 1% × (20,000 − 18,130).
      expect(computeIncomeTax(qc(40, { eligibleDividends: 20000 })).healthPremium).toBeCloseTo(18.7, 2)
    })

    it('counts retirement income where the split puts it, without an RRSP deduction', () => {
      expect(computeIncomeTax(qc(70, { pension: 60000, pensionSplit: -30000 })).healthPremium).toBeCloseTo(118.7, 2)
      expect(computeIncomeTax(qc(70, { pensionSplit: 30000 })).healthPremium).toBeCloseTo(118.7, 2)
      expect(computeIncomeTax(qc(40, { otherOrdinary: 30000, rrspDeduction: 10000 })).healthPremium).toBeCloseTo(118.7, 2)
    })

    it('does not apply outside Quebec', () => {
      expect(computeIncomeTax({ ...emptyIncome('BC', 40), otherOrdinary: 30000 }).healthPremium).toBe(0)
    })
  })

  describe('Schedule B: age and retirement amounts', () => {
    it('reduces them on family income and shares them between spouses', () => {
      const household = computeHouseholdTax([qc(70, { pension: 30000 }), qc(70, { pension: 30000 })], {})
      // Amounts: 2 × 3,986 + 2 × 3,541 = 15,054. Family income 60,000:
      // 18.75% × (60,000 − 42,955) = 3,195.94, leaving 11,858.06 at 14%.
      const beforeAmounts = 2 * (30000 * 0.14 - BASIC)
      const health = 2 * 118.7
      const provincial = household.perPerson.reduce((s, r) => s + r.provincial, 0)
      expect(provincial).toBeCloseTo(beforeAmounts - 11858.06 * 0.14 + health, 1)
    })

    it('uses a spouse\'s amounts even when that spouse has no tax to use them', () => {
      const household = computeHouseholdTax([qc(70, { pension: 60000 }), qc(70)], {})
      // Amounts 3,986 × 2 + 3,541 = 11,513, less 18.75% × (60,000 − 42,955) = 8,317.06.
      // Tax 8,682.75 − own basic credit 2,653.28 − 1,164.39 − spouse's unused 2,653.28.
      expect(household.perPerson[0].provincial).toBeCloseTo(2211.8 + 150, 1)
      expect(household.perPerson[1].provincial).toBe(0)
    })

    it('disappears at high family income', () => {
      const household = computeHouseholdTax([qc(70, { pension: 100000 }), qc(70, { pension: 100000 })], {})
      const withoutAmounts = 2 * computeIncomeTax(qc(40, { otherOrdinary: 100000 })).provincial
      expect(household.perPerson.reduce((s, r) => s + r.provincial, 0)).toBeCloseTo(withoutAmounts, 1)
    })

    it('gives the retirement amount at any age, on any line 122 income', () => {
      const expected = 30000 * 0.14 - BASIC - 3541 * 0.14 + 118.7
      expect(computeIncomeTax(qc(60, { pension: 30000 })).provincial).toBeCloseTo(expected, 2)
      expect(computeIncomeTax(qc(60, { registeredWithdrawals: 30000, nonEligibleRegistered: 30000 })).provincial).toBeCloseTo(expected, 2)
    })

    it('does not give it for CPP or OAS', () => {
      expect(computeIncomeTax(qc(60, { cpp: 30000 })).provincial).toBeCloseTo(30000 * 0.14 - BASIC + 118.7, 2)
    })

    it('multiplies retirement income by 1.25 up to the maximum', () => {
      // $2,000 × 1.25 = $2,500 of amount, against $18,952 of basic credit, so test
      // with enough other income for the credit to be usable.
      const r = computeIncomeTax(qc(60, { pension: 2000, otherOrdinary: 28000 }))
      expect(r.provincial).toBeCloseTo(30000 * 0.14 - BASIC - 2500 * 0.14 + 118.7, 2)
    })

    it('reduces a single person\'s amounts on their own income', () => {
      const r = computeIncomeTax(qc(70, { pension: 60000 }))
      // 3,986 + 3,541 − 18.75% × (60,000 − 42,955) = 4,331.06.
      expect(r.provincial).toBeCloseTo(60000 * 0.14 + (60000 - 54345) * 0.05 - BASIC - 4331.06 * 0.14 + 150, 1)
    })
  })

  describe('line 431: credits transferred between spouses', () => {
    it('moves one spouse\'s unused credits to the other', () => {
      const household = computeHouseholdTax([qc(40, { otherOrdinary: 80000 }), qc(40, { otherOrdinary: 5000 })], {})
      // 12,482.75 − 2,653.28 − the spouse's unused 1,953.28, plus $319.40 for the health fund.
      expect(household.perPerson[0].provincial).toBeCloseTo(7876.19 + 319.4, 1)
      expect(household.perPerson[1].provincial).toBe(0)
    })

    it('stops at the tax the other spouse has to pay', () => {
      const household = computeHouseholdTax([qc(40, { otherOrdinary: 20000 }), qc(40)], {})
      // $146.72 of tax is all that can be absorbed; the health fund isn't income tax.
      expect(household.perPerson[0].provincial).toBeCloseTo(18.7, 2)
    })

    it('does not transfer outside a Quebec couple', () => {
      const mixed = computeHouseholdTax([{ ...emptyIncome('QC', 40), otherOrdinary: 80000 }, { ...emptyIncome('ON', 40), otherOrdinary: 5000 }], {})
      expect(mixed.perPerson[0].provincial).toBeCloseTo(12482.75 - BASIC + 319.4, 1)
    })
  })

  describe('Schedule Q: splitting', () => {
    const couple = (age: number) => [qc(age, { pension: 80000 }), qc(age)]

    it('splits pension income federally under 65, but not in Quebec', () => {
      const household = computeHouseholdTax(couple(60), { splitting: true })
      expect(household.splits[1]).toBeGreaterThan(0)
      expect(household.quebecSplits[1]).toBe(0)
    })

    it('splits in Quebec from 65', () => {
      const household = computeHouseholdTax(couple(70), { splitting: true })
      expect(household.quebecSplits[1]).toBeGreaterThan(0)
    })

    it('never transfers more than half in Quebec', () => {
      const household = computeHouseholdTax(couple(70), { splitting: true })
      expect(household.quebecSplits[1]).toBeLessThanOrEqual(40000 + 1e-6)
    })

    it('keeps Quebec out of the federal figure and the reverse', () => {
      const separate = computeIncomeTax(qc(60, { pension: 80000, pensionSplit: -40000, quebecPensionSplit: 0 }))
      const tied = computeIncomeTax(qc(60, { pension: 80000, pensionSplit: -40000 }))
      expect(separate.federal).toBeCloseTo(tied.federal, 6)
      expect(separate.provincial).toBeGreaterThan(tied.provincial)
    })
  })
})

describe('low-income reductions (2025 provincial forms)', () => {
  const person = (province: ProvinceCode, age: number, otherOrdinary: number) => ({ ...emptyIncome(province, age), otherOrdinary })
  const provincial = (province: ProvinceCode, age: number, income: number) => computeIncomeTax(person(province, age, income)).provincial

  it('Newfoundland: $997, less 16% over $23,928', () => {
    expect(provincial('NL', 40, 20000)).toBe(0)
    // 2,175 − 1,139.18 credit − (997 − 16% × 1,072).
    expect(provincial('NL', 40, 25000)).toBeCloseTo(210.34, 2)
  })

  it('Newfoundland couple: one reduction on family income, over $40,460', () => {
    const household = computeHouseholdTax([person('NL', 40, 40000), person('NL', 40, 5000)], {})
    // 3,480 − 1,139.18 − spouse amount 439.96, less 1,554 − 16% × 4,540 = 827.60.
    expect(household.perPerson[0].provincial).toBeCloseTo(1073.26, 1)
    expect(household.perPerson[1].provincial).toBe(0)
  })

  it('PEI: adds $250 for age, less 5% over $22,650', () => {
    // 2,850 − 1,425 − 618.45 age credit, less 600 − 5% × 7,350 = 232.50.
    expect(provincial('PE', 70, 30000)).toBeCloseTo(574.05, 2)
  })

  it('Nova Scotia: $300, less 5% over $15,000', () => {
    // 1,758 − 1,048.82, less 300 − 5% × 5,000 = 50.
    expect(provincial('NS', 40, 20000)).toBeCloseTo(659.18, 2)
  })

  it('Nova Scotia: a $1,000 age credit under $24,000 of taxable income', () => {
    expect(provincial('NS', 70, 23000)).toBe(0)
    // No age credit at $24,000: 2,109.60 − 1,048.82 − 512.11.
    expect(provincial('NS', 70, 24000)).toBeCloseTo(548.67, 2)
  })

  it('New Brunswick: $802, less 3% over $21,920', () => {
    // 1,535.58 − (802 − 3% × 8,080 = 559.60).
    expect(provincial('NB', 40, 30000)).toBeCloseTo(975.98, 2)
  })

  it('does not touch other provinces', () => {
    expect(provincial('MB', 40, 20000)).toBeGreaterThan(0)
  })
})

describe('credits transferred between spouses (Schedule 2)', () => {
  const aloneOn = computeIncomeTax({ ...emptyIncome('ON', 70), otherOrdinary: 80000 })
  const couple = (cpp: number) => computeHouseholdTax([{ ...emptyIncome('ON', 70), otherOrdinary: 80000 }, { ...emptyIncome('ON', 70), cpp }], {})

  it('moves a low-income spouse\'s unused age amount', () => {
    const [higher] = couple(10000).perPerson
    // Federal: spouse amount 6,452 + age 9,208, at 14%.
    expect(aloneOn.federal - higher.federal).toBeCloseTo(2192.4, 1)
    // Ontario: spouse amount 11,029 − (10,000 − 1,103) = 2,132 + age 6,342, at 5.05%.
    expect(aloneOn.provincial - higher.provincial).toBeCloseTo(427.94, 1)
  })

  it('moves only the part the spouse can\'t use', () => {
    const [higher] = couple(20000).perPerson
    // Federal: 9,208 − (20,000 − 16,452) = 5,660, at 14%. No spouse amount at this income.
    expect(aloneOn.federal - higher.federal).toBeCloseTo(792.4, 1)
    // Ontario: 20,000 − 12,989 = 7,011 absorbs the 6,342.
    expect(aloneOn.provincial - higher.provincial).toBeCloseTo(0, 1)
  })

  it('moves a pension amount too', () => {
    const household = computeHouseholdTax([{ ...emptyIncome('BC', 70), otherOrdinary: 80000 }, { ...emptyIncome('BC', 70), pension: 2000 }], {})
    const alone = computeIncomeTax({ ...emptyIncome('BC', 70), otherOrdinary: 80000 })
    // Federal: spouse amount 14,452 + age 9,208 + pension 2,000, at 14%.
    expect(alone.federal - household.perPerson[0].federal).toBeCloseTo(3592.4, 1)
  })
})

// Expected values are rows of the published Oct–Dec 2026 tables, in dollars a
// month; the app's schedule is within one table step ($3) of each row.
describe('GIS and the Allowances', () => {
  const none = { otherIncome: 0, employmentIncome: 0 }
  const closeToMonthly = (annual: number, monthly: number) => expect(Math.abs(annual / 12 - monthly)).toBeLessThanOrEqual(3)

  it('follows Table 1 for a single person', () => {
    for (const [income, monthly] of [[0, 1138.9], [1000, 1097.9], [5000, 868.9], [12000, 462.49], [20000, 129.49]]) {
      closeToMonthly(gisAnnual([{ receivesOas: true, otherIncome: income, employmentIncome: 0 }])[0], monthly)
    }
    expect(gisAnnual([{ receivesOas: true, otherIncome: 23112, employmentIncome: 0 }])[0]).toBe(0)
  })

  it('follows Table 2 when both spouses receive OAS', () => {
    for (const [income, monthly] of [[0, 685.56], [3000, 623.56], [6000, 540.56], [15000, 323.57], [28000, 52.57]]) {
      const [a, b] = gisAnnual([{ receivesOas: true, otherIncome: income, employmentIncome: 0 }, { receivesOas: true, ...none }])
      closeToMonthly(a, monthly)
      closeToMonthly(b, monthly)
    }
  })

  it('follows Table 3 when the spouse gets neither OAS nor the Allowance', () => {
    for (const [income, monthly] of [[5000, 1128.9], [12000, 996.9], [30000, 528.49], [50000, 112.49]]) {
      const [gis, spouse] = gisAnnual([{ receivesOas: true, otherIncome: income, employmentIncome: 0 }, { receivesOas: false, ...none, age: 50, residencyYears: 40 }])
      closeToMonthly(gis, monthly)
      expect(spouse).toBe(0)
    }
  })

  it('follows Table 4 for a pensioner and a spouse aged 60 to 64', () => {
    for (const [income, pensioner, allowance] of [[1000, 685.56, 1388.06], [6000, 665.56, 1053.06], [20000, 474.57, 474.57], [35000, 262.92, 161.57]]) {
      const [gis, spouse] = gisAnnual([{ receivesOas: true, otherIncome: income, employmentIncome: 0 }, { receivesOas: false, ...none, age: 62, residencyYears: 40 }])
      closeToMonthly(gis, pensioner)
      closeToMonthly(spouse, allowance)
    }
  })

  it('needs ten years in Canada for the Allowance', () => {
    const [gis, spouse] = gisAnnual([{ receivesOas: true, ...none }, { receivesOas: false, ...none, age: 62, residencyYears: 5 }])
    closeToMonthly(gis, 1138.9)
    expect(spouse).toBe(0)
  })

  it('follows Table 5 for a widowed person aged 60 to 64', () => {
    for (const [income, monthly] of [[0, 1726.18], [1000, 1666.18], [8000, 1103.18], [20000, 464.27], [29000, 89.27]]) {
      closeToMonthly(gisAnnual([{ receivesOas: false, otherIncome: income, employmentIncome: 0, age: 62, residencyYears: 40, widowed: true }])[0], monthly)
    }
    expect(gisAnnual([{ receivesOas: false, otherIncome: 31152, employmentIncome: 0, age: 62, residencyYears: 40, widowed: true }])[0]).toBe(0)
  })

  it('needs widowhood for the survivor Allowance', () => {
    expect(gisAnnual([{ receivesOas: false, ...none, age: 62, residencyYears: 40 }])[0]).toBe(0)
    expect(gisAnnual([{ receivesOas: false, ...none, age: 66, residencyYears: 40, widowed: true }])[0]).toBe(0)
  })

  const oas = { oas: { startAge: 65, yearsInCanadaAfter18: 40 } }

  it('uses last year\'s income', () => {
    const { rows } = run(plan({
      people: [person(70, 65, oas)],
      accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 500000 }],
      incomes: [{ id: 'w', ownerId: 'a', kind: 'windfall', amount: 50000, frequency: 'oneTime', from: { kind: 'year', year: YEAR + 1 }, growth: { kind: 'none' } }],
      expenses: budget(20000), drawdown: EXPENSES,
    }))
    closeToMonthly(rows[1].gis, 1138.9)
    expect(rows[2].gis).toBe(0)
    closeToMonthly(rows[3].gis, 1138.9)
  })

  it('uses the lower current income once salary stops', () => {
    const { rows } = run(plan({
      people: [person(66, 67, oas)],
      accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 500000 }],
      incomes: [{ id: 'j', ownerId: 'a', kind: 'employment', amount: 60000, to: { kind: 'retirement', personId: 'a' }, growth: { kind: 'none' } }],
      expenses: budget(20000), drawdown: EXPENSES,
    }))
    expect(rows[0].gis).toBe(0)
    closeToMonthly(rows[1].gis, 1138.9)
  })

  it('pays the Allowance to a younger spouse, and the survivor Allowance after a death', () => {
    const { rows } = run(plan({
      people: [person(70, 65, { ...oas, lifeExpectancy: 71 }), spouse(62, 60, { ...oas, lifeExpectancy: 90 })],
      accounts: [{ id: 't', type: 'TFSA', ownerId: 'a', balance: 500000 }],
      expenses: budget(20000), drawdown: EXPENSES,
    }))
    closeToMonthly(rows[0].people[0].gis, 685.56)
    closeToMonthly(rows[0].people[1].gis, 1448.06)
    closeToMonthly(rows[2].people[1].gis, 1726.18)
  })
})

describe('survivor pensions', () => {
  const cpp = (over: object) => cppSurvivorBenefit({ deceasedPension: 15000, survivorOwnPension: 0, survivorAge: 70, ownPensionPayable: false, plan: 'cpp', ...over })

  it('matches the published 2026 CPP maximums with no pension of one\'s own', () => {
    expect(cpp({ deceasedPension: 1507.65 * 12, survivorAge: 60 }) / 12).toBeCloseTo(803.54, 1)
    expect(cpp({ deceasedPension: 1507.65 * 12, survivorAge: 70 }) / 12).toBeCloseTo(904.59, 1)
  })

  it('reduces by 40% of the survivor\'s own pension, at most 40% of the amount', () => {
    // C = 9,000; D = min(3,600, 40% × 3,000) = 1,200.
    expect(cpp({ survivorOwnPension: 3000, ownPensionPayable: true })).toBeCloseTo(7800, 2)
  })

  it('caps the combined pension at the published maximum', () => {
    // C − D = 5,400, but only 18,378.72 − 15,000 of room.
    expect(cpp({ survivorOwnPension: 15000, ownPensionPayable: true })).toBeCloseTo(3378.72, 2)
  })

  it('keeps the flat rate under 65 with a pension of one\'s own', () => {
    // C = 5,625; D = min(2,250, 3,600); plus the flat rate.
    expect(cpp({ survivorAge: 62, survivorOwnPension: 9000, ownPensionPayable: true })).toBeCloseTo(3375 + 238.17 * 12, 2)
  })

  it('uses the QPP fixed portions by age', () => {
    const qpp = (survivorAge: number) => cpp({ plan: 'qpp', survivorAge })
    // 2026 fixed portions, from the published maximums: $156.35 and $610.43 a month.
    expect(qpp(40)).toBeCloseTo(5625 + 156.35 * 12, 0)
    expect(qpp(50)).toBeCloseTo(5625 + 610.43 * 12, 0)
    expect(qpp(70)).toBeCloseTo(9000, 2)
  })

  it('does not reduce the deceased\'s pension for an early start', () => {
    const p = plan({
      people: [person(70, 65, { lifeExpectancy: 70, cpp: { mode: 'amount', amountAt65: 12000 }, cppStartAge: 60 }), spouse(70, 65, { lifeExpectancy: 80, cpp: { mode: 'amount', amountAt65: 0 } })],
    })
    expect(run(p).rows[1].people[1].cpp).toBeCloseTo(7200, 2)
  })
})

describe('QPP retirement rules (Retraite Québec leaflet 1036-2)', () => {
  it('reduces an early pension by 0.5% to 0.6% a month with its size', () => {
    // Retraite Québec 2026: $1,507.65 at 65, $964.90 at 60 (64%).
    expect(getCppIncomeAtAge(1507.65 * 12, 60, 60, 72) / 12).toBeCloseTo(964.9, 1)
    // Half the base-plan maximum of $1,441.25 (s. 116.6): 1 − 60 × (0.5 + 0.1 × 0.5)%.
    expect(getCppIncomeAtAge(1441.25 * 6, 60, 60, 72)).toBeCloseTo(1441.25 * 6 * 0.67, 2)
  })

  it('keeps CPP at 0.6% a month', () => {
    expect(getCppIncomeAtAge(10000, 60, 60)).toBeCloseTo(6400, 6)
  })

  it('drops the lowest 15% of the QPP reference period, against 17% for the CPP', () => {
    const history = { birthYear: 1980, retirementAge: 65, startedWorkingYear: 1998, typicalEarnings: 50000, yearsNotWorking: 0, childRearingYears: 0 }
    expect(estimateCppFromHistory(history).countedYears).toBe(39)
    expect(estimateCppFromHistory({ ...history, province: 'QC' }).countedYears).toBe(40)
  })
})

// Act respecting the Québec Pension Plan (R-9), ss. 133 to 137, in monthly
// amounts. a = the deceased's pension; c = the base-plan maximum, $1,441.25 in
// 2026 (s. 116.6), adjusted for the survivor's own start age at the full rate;
// d = the survivor's own pension as paid. Flat amounts: $156.35 under 45,
// $610.43 from 45 (the gaps between the published 2026 maximums).
describe('QPP surviving spouse\'s pension (R-9)', () => {
  const qpp = (over: object) => cppSurvivorBenefit({ deceasedPension: 12000, survivorOwnPension: 0, survivorAge: 70, ownPensionPayable: false, plan: 'qpp', ...over }) / 12

  it('s. 133: under 65 with no pension of one\'s own, 37.5% plus the flat amount', () => {
    expect(qpp({ survivorAge: 50 })).toBeCloseTo(985.43, 2)
    expect(qpp({ survivorAge: 40 })).toBeCloseTo(531.35, 2)
  })

  it('s. 134: from 65 with no pension of one\'s own, 60%', () => {
    expect(qpp({})).toBeCloseTo(600, 2)
  })

  it('s. 136.1: from 65, the lesser of c − d and the greater of 37.5% and 60% − 40% of d', () => {
    const own = (d: number, startAge = 65) => qpp({ ownPensionPayable: true, survivorOwnPension: d * 12, survivorOwnPensionPaid: d * 12, survivorStartAge: startAge })
    expect(own(800)).toBeCloseTo(375, 2)
    expect(own(200)).toBeCloseTo(520, 2)
    expect(own(1400)).toBeCloseTo(41.25, 2)
    // Started at 70: c = 1,441.25 × 1.42 = 2,046.58.
    expect(own(1400, 70)).toBeCloseTo(375, 2)
  })

  it('s. 136: under 65, the lesser of 37.5% plus flat and flat plus c − d', () => {
    const own = (d: number) => qpp({ survivorAge: 62, ownPensionPayable: true, survivorOwnPension: d * 12 / 0.64, survivorOwnPensionPaid: d * 12, survivorStartAge: 60 })
    // c = 1,441.25 × 0.64 = 922.40; H = 610.43 + 922.40 − 800.
    expect(own(800)).toBeCloseTo(732.83, 2)
    expect(own(500)).toBeCloseTo(985.43, 2)
  })

  it('pays it alongside the survivor\'s own pension in a projection', () => {
    const qc = { province: 'QC' as const }
    const { rows } = run(plan({
      people: [
        person(70, 65, { ...qc, lifeExpectancy: 70, cpp: { mode: 'amount', amountAt65: 12000 }, cppStartAge: 65 }),
        spouse(70, 65, { ...qc, lifeExpectancy: 85, cpp: { mode: 'amount', amountAt65: 6000 }, cppStartAge: 65 }),
      ],
    }))
    // Own 6,000; survivor min(17,295 − 6,000, max(4,500, 7,200 − 2,400)) = 4,800.
    expect(rows[1].people[1].cpp).toBeCloseTo(10800, 2)
  })
})
