import { describe, it, expect } from 'vitest'
import yaml from 'js-yaml'
import { exportToYAML, importFromYAML } from '@/lib/yaml-utils'
import { migrateV1ToV2 } from '@/lib/plan/migrate'
import { toLegacyPeople } from '@/lib/plan/legacy-view'
import type { Person } from '@/types/person'
import type { PlanAssumptions, RetirementPlan } from '@/types/plan'

const NOW = new Date('2026-06-15T12:00:00Z')
const NOW_YEAR = NOW.getFullYear()

const mockAssumptions: PlanAssumptions = {
  expectedReturn: 7,
  inflationRate: 2.5,
  replacementRate: 70,
  withdrawalRate: 4,
  showRealValues: true,
  plannedGifts: [],
  workingMarginalTaxRate: 30,
  reinvestRrspRefund: false,
}

const mockPeople: Person[] = [
  {
    id: 'test-1',
    name: 'Alice',
    currentAge: 35,
    retirementAge: 65,
    annualIncome: 100000,
    annualPension: 0,
    annualCpp: 18000,
    cppStartAge: 60,
    oasStartAge: 70,
    accounts: [
      { id: 'acc-1', type: 'RRSP', balance: 50000, annualContribution: 5000 },
      { id: 'acc-2', type: 'TFSA', balance: 30000, annualContribution: 6000 },
    ],
  },
]

function v1Plan(people: Person[] = mockPeople): RetirementPlan {
  return { version: '1.0', assumptions: mockAssumptions, people }
}

function v2Plan(people: Person[] = mockPeople) {
  return migrateV1ToV2(v1Plan(people), { now: NOW, id: 'plan-1' }).plan
}

describe('yaml-utils', () => {
  describe('exportToYAML', () => {
    it('exports a v2 YAML document', () => {
      const result = exportToYAML(v2Plan())
      expect(result).toContain('schemaVersion: 2')
      expect(result).toContain('people:')
      expect(result).toContain('accounts:')
      expect(result).toContain('Alice')
      expect(result).toContain('RRSP')
    })

    it('includes assumptions and account data', () => {
      const result = exportToYAML(v2Plan())
      expect(result).toContain('expectedReturn: 7')
      expect(result).toContain('inflationRate: 2.5')
      expect(result).toContain('replacementRate: 70')
      expect(result).toContain('ratePct: 4')
      expect(result).toContain('workingMarginalTaxRate: 30')
      expect(result).toContain('balance: 50000')
      expect(result).toContain('amount: 5000')
    })
  })

  describe('importFromYAML', () => {
    it('round-trips a v2 export', () => {
      const plan = v2Plan()
      const imported = importFromYAML(exportToYAML(plan), NOW)
      expect(imported).not.toBeNull()
      expect(imported!.migratedFrom).toBeNull()
      expect(imported!.plan).toEqual(plan)
    })

    it('migrates a v1 file and preserves every v1 value', () => {
      const imported = importFromYAML(yaml.dump(v1Plan()), NOW)
      expect(imported).not.toBeNull()
      expect(imported!.migratedFrom).toBe(1)
      expect(imported!.uiPrefs).toEqual({ showRealValues: true })
      expect(imported!.plan.people[0].province).toBe('QC')
      expect(toLegacyPeople(imported!.plan, NOW_YEAR)).toEqual(mockPeople)
    })

    it('returns null for empty string', () => {
      expect(importFromYAML('')).toBeNull()
    })

    it('returns null for invalid YAML', () => {
      expect(importFromYAML(':\n  : invalid')).toBeNull()
    })

    it('returns null for v1 YAML missing assumptions', () => {
      const doc = 'version: "1.0"\npeople: []\n'
      expect(importFromYAML(doc)).toBeNull()
    })

    it('returns null for v1 YAML missing people', () => {
      const doc = 'version: "1.0"\nassumptions:\n  expectedReturn: 7\n'
      expect(importFromYAML(doc)).toBeNull()
    })

    it('returns null for v2 YAML with an unknown account owner', () => {
      const plan = v2Plan()
      const broken = { ...plan, accounts: [{ ...plan.accounts[0], ownerId: 'nobody' }] }
      expect(importFromYAML(yaml.dump(broken), NOW)).toBeNull()
    })

    it('handles special characters in names', () => {
      const people: Person[] = [{
        id: '1',
        name: 'Renée & Pierre',
        currentAge: 30,
        retirementAge: 65,
        annualIncome: 0,
        annualPension: 0,
        accounts: [],
      }]
      const imported = importFromYAML(exportToYAML(v2Plan(people)), NOW)
      expect(imported!.plan.people[0].name).toBe('Renée & Pierre')
    })
  })
})
