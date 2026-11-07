import { describe, it, expect } from 'vitest'
import { migrateV1ToV2, parsePlanData, detectSchemaVersion } from '@/lib/plan/migrate'
import { toLegacyAssumptions, toLegacyPeople } from '@/lib/plan/legacy-view'
import { loadStore, readLegacyStorage, serializeStore, STORE_KEY } from '@/lib/plan/storage'
import { createDefaultPlan } from '@/lib/plan/defaults'
import { deletePerson, setLegacyGifts, updateLegacyPersonField, setIncomeAmount } from '@/lib/plan/edits'
import { resolveYear } from '@/lib/plan/time'
import type { RetirementPlan } from '@/types/plan'

const NOW = new Date('2026-06-15T12:00:00Z')
const YEAR = 2026

const v1: RetirementPlan = {
  version: '1.0',
  assumptions: {
    expectedReturn: 6,
    inflationRate: 2.1,
    replacementRate: 65,
    withdrawalRate: 3.8,
    showRealValues: false,
    workingMarginalTaxRate: 37,
    reinvestRrspRefund: true,
    plannedGifts: [
      { id: 'g1', label: 'Wedding', amount: 30000, age: 60 },
      { id: 'g2', label: 'Down payment', amount: 80000, age: 67 },
    ],
  },
  people: [
    {
      id: 'a',
      name: 'Simon',
      currentAge: 34,
      retirementAge: 65,
      annualIncome: 140000,
      annualPension: 0,
      annualCpp: 18100,
      cppStartAge: 70,
      oasStartAge: 67,
      accounts: [
        { id: 'a-1', type: 'RRSP', balance: 48000, annualContribution: 10000 },
        { id: 'a-2', type: 'TFSA', balance: 29000, annualContribution: 0 },
      ],
    },
    {
      id: 'b',
      name: 'Jessie',
      currentAge: 31,
      retirementAge: 58,
      annualIncome: 90000,
      annualPension: 70000,
      annualCpp: 15000,
      cppStartAge: 65,
      oasStartAge: 65,
      accounts: [{ id: 'b-1', type: 'RRSP', balance: 30000, annualContribution: 5000 }],
    },
  ],
}

class MemoryStorage {
  private data = new Map<string, string>()
  getItem(key: string) { return this.data.has(key) ? this.data.get(key)! : null }
  setItem(key: string, value: string) { this.data.set(key, value) }
}

describe('v1 → v2 migration', () => {
  const { plan, uiPrefs } = migrateV1ToV2(v1, { now: NOW, id: 'p' })

  it('maps people to birth years, Quebec, and the v1 benefit settings', () => {
    expect(plan.schemaVersion).toBe(2)
    expect(plan.asOf).toBe('2026-06-15')
    expect(plan.people[0]).toMatchObject({
      birthYear: 1992, province: 'QC', retirementAge: 65, lifeExpectancy: 95,
      cpp: { mode: 'amount', amountAt65: 18100 }, cppStartAge: 70, oas: { startAge: 67 },
    })
  })

  it('flattens accounts with owners and contributions that stop at retirement', () => {
    expect(plan.accounts).toHaveLength(3)
    expect(plan.accounts[0]).toMatchObject({
      id: 'a-1', ownerId: 'a', type: 'RRSP', balance: 48000,
      contributions: [{ amount: 10000, indexed: false, to: { kind: 'retirement', personId: 'a' } }],
    })
    expect(plan.accounts[1].contributions).toEqual([])
  })

  it('turns income and pension into streams bounded by retirement', () => {
    const jessie = plan.incomes.filter(i => i.ownerId === 'b')
    expect(jessie.map(i => i.kind)).toEqual(['employment', 'dbPension'])
    expect(jessie[0].to).toEqual({ kind: 'retirement', personId: 'b', offset: 0 })
    expect(jessie[1].from).toEqual({ kind: 'retirement', personId: 'b', offset: 0 })
    expect(plan.incomes.filter(i => i.ownerId === 'a').map(i => i.kind)).toEqual(['employment'])
  })

  it('anchors gifts to the youngest person so the v1 household age is kept', () => {
    const gifts = plan.expenses.items
    expect(gifts.map(g => g.from)).toEqual([
      { kind: 'age', personId: 'b', age: 60 },
      { kind: 'age', personId: 'b', age: 67 },
    ])
    expect(resolveYear(gifts[0].from, plan.people, YEAR, 0)).toBe(1995 + 60)
  })

  it('moves assumptions and display prefs to their new homes', () => {
    expect(plan.expenses).toMatchObject({ mode: 'simple', replacementRate: 65 })
    expect(plan.drawdown.strategy).toEqual({ kind: 'initialPct', ratePct: 3.8 })
    expect(plan.assumptions).toEqual({ expectedReturn: 6, inflationRate: 2.1, workingMarginalTaxRate: 37, reinvestRrspRefund: true })
    expect(uiPrefs).toEqual({ showRealValues: false })
  })

  it('reads back as the exact v1 plan through the legacy view', () => {
    expect(toLegacyPeople(plan, YEAR)).toEqual(v1.people)
    expect(toLegacyAssumptions(plan, { showRealValues: false }, YEAR)).toEqual(v1.assumptions)
  })

  it('is idempotent: parsing the migrated plan changes nothing', () => {
    const result = parsePlanData(JSON.parse(JSON.stringify(plan)), { now: NOW })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.migratedFrom).toBeNull()
      expect(result.plan).toEqual(plan)
    }
  })

  it('detects schema versions', () => {
    expect(detectSchemaVersion(v1)).toBe(1)
    expect(detectSchemaVersion(plan)).toBe(2)
    expect(detectSchemaVersion({ foo: 1 })).toBeNull()
    expect(detectSchemaVersion(null)).toBeNull()
  })

  it('rejects v1 files whose retirement age is not after the current age', () => {
    const bad = { ...v1, people: [{ ...v1.people[0], retirementAge: 30 }] }
    expect(parsePlanData(bad, { now: NOW }).success).toBe(false)
    expect(parsePlanData(bad, { now: NOW, lenientV1: true }).success).toBe(true)
  })
})

describe('plan storage', () => {
  it('migrates the loose v1 localStorage keys, tolerating gifts without ids', () => {
    const storage = new MemoryStorage()
    storage.setItem('people', JSON.stringify(v1.people))
    storage.setItem('expectedReturn', '6')
    storage.setItem('withdrawalRate', '3.8')
    storage.setItem('showRealValues', 'false')
    storage.setItem('plannedGifts', JSON.stringify([{ amount: 100000, age: 65 }]))

    const state = loadStore(storage, NOW)
    expect(state.plans).toHaveLength(1)
    expect(state.uiPrefs.showRealValues).toBe(false)
    const assumptions = toLegacyAssumptions(state.plans[0], state.uiPrefs, YEAR)
    expect(assumptions.expectedReturn).toBe(6)
    expect(assumptions.inflationRate).toBe(2.5)
    expect(assumptions.plannedGifts).toEqual([{ id: 'gift-1', label: 'Gift', amount: 100000, age: 65 }])
    expect(toLegacyPeople(state.plans[0], YEAR)).toEqual(v1.people)
  })

  it('returns no legacy plan when nothing is stored', () => {
    expect(readLegacyStorage(new MemoryStorage())).toBeNull()
  })

  it('falls back to the default plan for an empty browser', () => {
    const state = loadStore(new MemoryStorage(), NOW)
    expect(state.plans).toHaveLength(1)
    expect(state.plans[0].people[0].name).toBe('You')
    expect(state.activePlanId).toBe(state.plans[0].id)
  })

  it('round-trips the v2 store and prefers it over legacy keys', () => {
    const storage = new MemoryStorage()
    storage.setItem('people', JSON.stringify(v1.people))
    const a = createDefaultPlan(NOW, 'A')
    const b = migrateV1ToV2(v1, { now: NOW, id: 'b', name: 'B' }).plan
    storage.setItem(STORE_KEY, serializeStore({ activePlanId: 'b', plans: [a, b], uiPrefs: { showRealValues: false } })!)

    const state = loadStore(storage, NOW)
    expect(state.plans).toEqual([a, b])
    expect(state.activePlanId).toBe('b')
    expect(state.uiPrefs.showRealValues).toBe(false)
  })

  it('drops a corrupt stored plan but keeps the others', () => {
    const storage = new MemoryStorage()
    const good = createDefaultPlan(NOW, 'Good')
    storage.setItem(STORE_KEY, JSON.stringify({ schemaVersion: 2, activePlanId: 'gone', plans: [{ schemaVersion: 2, junk: true }, good] }))

    const state = loadStore(storage, NOW)
    expect(state.plans).toEqual([good])
    expect(state.activePlanId).toBe(good.id)
  })

  it('skips writing while a plan is mid-edit and invalid', () => {
    const plan = createDefaultPlan(NOW)
    const editing = updateLegacyPersonField(plan, plan.people[0].id, 'currentAge', NaN, YEAR)
    expect(serializeStore({ activePlanId: plan.id, plans: [editing], uiPrefs: { showRealValues: true } })).toBeNull()
  })
})

describe('plan edits', () => {
  const { plan } = migrateV1ToV2(v1, { now: NOW, id: 'p' })

  it('maps legacy field edits onto the v2 model', () => {
    let next = updateLegacyPersonField(plan, 'a', 'currentAge', 40, YEAR)
    next = updateLegacyPersonField(next, 'a', 'oasStartAge', 70, YEAR)
    next = updateLegacyPersonField(next, 'a', 'annualCpp', 12000, YEAR)
    const person = toLegacyPeople(next, YEAR)[0]
    expect(person).toMatchObject({ currentAge: 40, oasStartAge: 70, annualCpp: 12000 })
    expect(next.people[0].birthYear).toBe(1986)
  })

  it('creates and removes the primary income stream as the amount changes', () => {
    const withPension = setIncomeAmount(plan, 'a', 'dbPension', 20000)
    expect(toLegacyPeople(withPension, YEAR)[0].annualPension).toBe(20000)
    const without = setIncomeAmount(withPension, 'a', 'dbPension', 0)
    expect(without.incomes.filter(i => i.ownerId === 'a' && i.kind === 'dbPension')).toEqual([])
  })

  it('keeps event dates when the person they follow is deleted', () => {
    const next = deletePerson(plan, 'b', YEAR)
    expect(next.people.map(p => p.id)).toEqual(['a'])
    expect(next.accounts.every(a => a.ownerId === 'a')).toBe(true)
    expect(next.expenses.items[0].from).toEqual({ kind: 'year', year: 1995 + 60 })
  })

  it('re-anchors gifts when the household changes', () => {
    const next = setLegacyGifts(plan, [{ id: 'g', label: 'X', amount: 1, age: 70 }])
    expect(next.expenses.items).toHaveLength(1)
    expect(toLegacyAssumptions(next, { showRealValues: true }, YEAR).plannedGifts[0].age).toBe(70)
  })
})
