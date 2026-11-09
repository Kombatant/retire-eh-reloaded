import { describe, it, expect } from 'vitest'
import { createDefaultPlan } from '@/lib/plan/defaults'
import { advancedSettingsInUse } from '@/lib/plan/advanced'
import { addAccount, addPerson, patchAccount, patchDrawdown, patchEstate, patchPerson } from '@/lib/plan/edits'
import type { PlanV2 } from '@/lib/plan/schema'

const NOW = new Date(2026, 0, 1)
const sections = (plan: PlanV2) => advancedSettingsInUse(plan).map(s => s.section)

describe('advancedSettingsInUse', () => {
  it('finds nothing in a new plan', () => {
    expect(advancedSettingsInUse(createDefaultPlan(NOW))).toEqual([])
  })

  it('reports hidden settings by section', () => {
    let plan = createDefaultPlan(NOW)
    const personId = plan.people[0].id
    plan = patchPerson(plan, personId, { room: { rrsp: 10000, tfsa: 5000 } })
    plan = patchAccount(plan, plan.accounts[0].id, { returnOverridePct: 5 })
    plan = patchDrawdown(plan, { meltdown: { enabled: true, targetTaxableIncome: 57000 }, order: 'custom' })
    plan = patchEstate(plan, { probate: false })

    expect(sections(plan)).toEqual(['household', 'savings', 'withdrawals', 'withdrawals', 'withdrawals'])
    expect(advancedSettingsInUse(plan).map(s => s.label)).toContain('RRSP meltdown')
  })

  it('reports the reinvested money mix only when the plan creates that account', () => {
    const label = 'Investment mix for reinvested money'
    const base = createDefaultPlan(NOW)
    const withoutNonReg = { ...base, accounts: base.accounts.filter(a => a.type !== 'NONREG') }
    const plan = patchDrawdown(withoutNonReg, { reinvestGrowth: { returnOverridePct: 5 } })
    expect(advancedSettingsInUse(plan).map(s => s.label)).toContain(label)

    const withNonReg = addAccount(plan, base.people[0].id, 'NONREG', 'n')
    expect(advancedSettingsInUse(withNonReg).map(s => s.label)).not.toContain(label)
  })

  it('names the person when the plan is for a couple', () => {
    let plan = addPerson(createDefaultPlan(NOW), NOW, 'p2')
    plan = patchPerson(plan, 'p2', { room: { rrsp: 0, tfsa: 0 } })
    expect(advancedSettingsInUse(plan)[0].label).toBe(`Contribution room tracking (${plan.people[1].name})`)
  })

  it('treats couple-only settings as advanced only for couples', () => {
    const single = patchDrawdown(createDefaultPlan(NOW), { rrifUseYoungerSpouseAge: true })
    expect(advancedSettingsInUse(single)).toEqual([])
    const couple = patchDrawdown(addPerson(createDefaultPlan(NOW), NOW), { rrifUseYoungerSpouseAge: true })
    expect(sections(couple)).toEqual(['withdrawals'])
  })

  it('ignores stock accounts, whose editor is always shown', () => {
    const plan = addAccount(createDefaultPlan(NOW), createDefaultPlan(NOW).people[0].id, 'STOCK')
    expect(advancedSettingsInUse(plan)).toEqual([])
  })
})
