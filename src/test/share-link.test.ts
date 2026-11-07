import { describe, it, expect } from 'vitest'
import yaml from 'js-yaml'
import { deflateSync, strToU8 } from 'fflate'
import { buildShareUrl, decodePlan, encodePlan, readSharePlanFromUrl } from '@/lib/share-link'
import { migrateV1ToV2 } from '@/lib/plan/migrate'
import { toLegacyPeople } from '@/lib/plan/legacy-view'
import type { Person } from '@/types/person'
import type { PlanAssumptions, RetirementPlan } from '@/types/plan'

const NOW = new Date('2026-06-15T12:00:00Z')

const assumptions: PlanAssumptions = {
  expectedReturn: 7,
  inflationRate: 2.5,
  replacementRate: 70,
  withdrawalRate: 4,
  showRealValues: true,
  plannedGifts: [],
  workingMarginalTaxRate: 30,
  reinvestRrspRefund: false,
}

const people: Person[] = [
  {
    id: 'person-1',
    name: 'Alice',
    currentAge: 40,
    retirementAge: 65,
    annualIncome: 100000,
    annualPension: 0,
    annualCpp: 18092,
    cppStartAge: 65,
    oasStartAge: 70,
    accounts: [
      { id: 'account-1', type: 'RRSP', balance: 250000, annualContribution: 12000 },
      { id: 'account-2', type: 'TFSA', balance: 80000, annualContribution: 6000 },
    ],
  },
]

const v1: RetirementPlan = { version: '1.0', assumptions, people }
const plan = migrateV1ToV2(v1, { now: NOW, id: 'plan-1' }).plan

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach(b => { binary += String.fromCharCode(b) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

describe('share links', () => {
  it('round-trips a plan through the compressed URL payload', () => {
    const decoded = decodePlan(encodePlan(plan))

    expect(decoded).not.toBeNull()
    expect(decoded!.plan).toEqual(plan)
  })

  it('still opens links created by the v1 app', () => {
    // v1 links carried deflated v1 YAML in the same fragment format.
    const legacyPayload = base64Url(deflateSync(strToU8(yaml.dump(v1)), { level: 9 }))
    const decoded = readSharePlanFromUrl(`https://example.com/retire-eh/#plan=${legacyPayload}`)

    expect(decoded).not.toBeNull()
    expect(decoded!.migratedFrom).toBe(1)
    expect(toLegacyPeople(decoded!.plan, new Date().getFullYear())).toEqual(people)
  })

  it('builds a share URL with the plan in the fragment', () => {
    const url = buildShareUrl(plan, 'https://example.com/retire-eh/')

    expect(url).toMatch(/^https:\/\/example\.com\/retire-eh\/#plan=/)
    const decoded = readSharePlanFromUrl(url)
    expect(decoded).not.toBeNull()
    expect(decoded!.plan.people[0].name).toBe('Alice')
  })

  it('does not put the plan in plain text in the URL', () => {
    const url = buildShareUrl(plan, 'https://example.com/retire-eh/')

    expect(url).not.toContain('Alice')
    expect(url).not.toContain('250000')
  })

  it('ignores URLs without a share payload', () => {
    expect(readSharePlanFromUrl('https://example.com/retire-eh/')).toBeNull()
    expect(readSharePlanFromUrl('https://example.com/retire-eh/#plan=garbage')).toBeNull()
  })
})
