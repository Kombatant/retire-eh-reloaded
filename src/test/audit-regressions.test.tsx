import { describe, expect, it } from 'vitest'
import { planSchema, type PlanV2, type PlanV2Input } from '@/lib/plan/schema'
import { compilePlan, deterministicPath, simulate } from '@/lib/sim'
import { runSucceeded, successIsMeaningful } from '@/lib/sim/risk'
import { computeHouseholdTax } from '@/lib/tax/household'
import { computeIncomeTax, emptyIncome } from '@/lib/tax/personal'
import { payrollContributions } from '@/lib/tax/payroll'
import { TAX_2026 } from '@/lib/tax/data/2026'
import { deletePerson } from '@/lib/plan/edits'
import { diagnosePlan, isRealDate } from '@/lib/plan/diagnostics'
import { withContributionsStoppingIn } from '@/lib/insights/fi'
import { buildSankeyData } from '@/lib/insights/sankey'
import { buildMilestones } from '@/lib/insights/milestones'
import { bracketPosition } from '@/lib/insights/brackets'
import { getCppIncomeAtAge } from '@/lib/calculations'
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
    expect(run(p('ON')).first.withdrawal).toBeCloseTo(7100, -1)
  })

  it('follows the account jurisdiction, not the home province', () => {
    const p = plan({
      people: [person(60, 55, { province: 'QC' })],
      accounts: [{ id: 'l', type: 'LIF', ownerId: 'a', balance: 100000, jurisdiction: 'FED' }],
      expenses: budget(30000), drawdown: EXPENSES,
    })
    expect(run(p).first.withdrawal).toBeCloseTo(7100, -1)
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

  it('does not store the same copy twice', () => {
    const storage = memory()
    preserveRecovery(storage, { raw: 'x', problems: ['y'] }, NOW)
    preserveRecovery(storage, { raw: 'x', problems: ['y'] }, NOW)
    expect(JSON.parse(storage.data.get(RECOVERY_KEY)!)).toHaveLength(1)
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
