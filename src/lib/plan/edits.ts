import type { Person } from '@/types/person'
import type { PlannedGift } from '@/types/plan'
import {
  GIFT_CATEGORY,
  type AccountV2,
  type ExpenseItem,
  type IncomeStream,
  type PersonV2,
  type PlanV2,
} from './schema'
import { createDefaultPerson } from './defaults'
import { newId } from './ids'
import { detachPersonTimePoints, youngestPerson } from './time'

// Pure plan transforms. The legacy usePeople/useAssumptions hooks map their v1
// operations onto these, so the v2 plan stays the single source of truth.

type PersonPatch = Partial<PersonV2>

function patchPerson(plan: PlanV2, personId: string, patch: PersonPatch): PlanV2 {
  return { ...plan, people: plan.people.map(p => (p.id === personId ? { ...p, ...patch } : p)) }
}

// Set the amount of a person's primary income stream of a kind, creating it if
// needed. A zero amount removes the stream so the plan does not fill up with
// empty placeholder rows.
function setPrimaryIncome(
  plan: PlanV2,
  personId: string,
  kind: 'employment' | 'dbPension',
  amount: number,
): PlanV2 {
  const existing = plan.incomes.find(i => i.ownerId === personId && i.kind === kind && i.frequency === 'annual')
  if (existing) {
    if (amount <= 0 && Number.isFinite(amount)) {
      return { ...plan, incomes: plan.incomes.filter(i => i.id !== existing.id) }
    }
    return { ...plan, incomes: plan.incomes.map(i => (i.id === existing.id ? { ...i, amount } : i)) }
  }
  if (!(amount > 0)) return plan
  const stream: IncomeStream = kind === 'employment'
    ? {
        id: newId('income'), ownerId: personId, label: 'Salary', kind, amount, frequency: 'annual',
        to: { kind: 'retirement', personId, offset: 0 }, growth: { kind: 'cpi', pct: 0 }, taxTreatment: 'ordinary',
      }
    : {
        id: newId('income'), ownerId: personId, label: 'Employer pension', kind, amount, frequency: 'annual',
        from: { kind: 'retirement', personId, offset: 0 }, growth: { kind: 'cpi', pct: 0 }, taxTreatment: 'ordinary',
        db: { indexationPctOfCpi: 100, survivorPct: 60 },
      }
  return { ...plan, incomes: [...plan.incomes, stream] }
}

export function updateLegacyPersonField(
  plan: PlanV2,
  personId: string,
  field: keyof Person,
  value: string | number,
  nowYear: number,
): PlanV2 {
  const person = plan.people.find(p => p.id === personId)
  if (!person) return plan
  const num = Number(value)
  switch (field) {
    case 'name':
      return patchPerson(plan, personId, { name: String(value) })
    case 'currentAge':
      return patchPerson(plan, personId, { birthYear: nowYear - num })
    case 'retirementAge':
      return patchPerson(plan, personId, { retirementAge: num })
    case 'annualCpp':
      return patchPerson(plan, personId, { cpp: { mode: 'amount', amountAt65: num } })
    case 'cppStartAge':
      return patchPerson(plan, personId, { cppStartAge: num })
    case 'oasStartAge':
      return patchPerson(plan, personId, { oas: { ...person.oas, startAge: num } })
    case 'annualIncome':
      return setPrimaryIncome(plan, personId, 'employment', num)
    case 'annualPension':
      return setPrimaryIncome(plan, personId, 'dbPension', num)
    default:
      return plan
  }
}

export function setIncomeAmount(plan: PlanV2, personId: string, kind: 'employment' | 'dbPension', amount: number): PlanV2 {
  return setPrimaryIncome(plan, personId, kind, amount)
}

export function addPerson(plan: PlanV2, now: Date, id: string = newId('person')): PlanV2 {
  const person = createDefaultPerson({
    id,
    name: `Person ${plan.people.length + 1}`,
    currentAge: 35,
    now,
    province: plan.people[0]?.province,
  })
  return { ...plan, people: [...plan.people, person] }
}

export function deletePerson(plan: PlanV2, personId: string, nowYear: number): PlanV2 {
  if (plan.people.length <= 1) return plan
  const detached = detachPersonTimePoints(plan, personId, nowYear)
  return {
    ...detached,
    people: detached.people.filter(p => p.id !== personId),
    accounts: detached.accounts.filter(a => a.ownerId !== personId),
    incomes: detached.incomes.filter(i => i.ownerId !== personId),
    properties: detached.properties.map(pr => (pr.ownerId === personId ? { ...pr, ownerId: 'joint' } : pr)),
  }
}

export function addAccount(plan: PlanV2, ownerId: string, type: AccountV2['type'], id: string = newId('account')): PlanV2 {
  const base = { id, ownerId, label: '', balance: 0, contributions: [] }
  let account: AccountV2
  switch (type) {
    case 'FHSA':
      account = { ...base, type, lifetimeContributed: 0 }
      break
    default:
      account = { ...base, type } as AccountV2
  }
  return { ...plan, accounts: [...plan.accounts, account] }
}

export function deleteAccount(plan: PlanV2, accountId: string): PlanV2 {
  return { ...plan, accounts: plan.accounts.filter(a => a.id !== accountId) }
}

export function setAccountBalance(plan: PlanV2, accountId: string, balance: number): PlanV2 {
  return { ...plan, accounts: plan.accounts.map(a => (a.id === accountId ? { ...a, balance } : a)) }
}

// v1 accounts have a single flat contribution that runs until the owner retires.
export function setAccountAnnualContribution(plan: PlanV2, accountId: string, amount: number): PlanV2 {
  return {
    ...plan,
    accounts: plan.accounts.map(a => {
      if (a.id !== accountId) return a
      const [first, ...rest] = a.contributions
      const rule = first
        ? { ...first, amount }
        : { amount, indexed: false, to: { kind: 'retirement' as const, personId: a.ownerId, offset: 0 } }
      return { ...a, contributions: [rule, ...rest] }
    }),
  }
}

function giftToItem(plan: PlanV2, gift: Pick<PlannedGift, 'id' | 'label' | 'amount' | 'age'>): ExpenseItem {
  const youngest = youngestPerson(plan.people)
  return {
    id: gift.id,
    label: gift.label,
    category: GIFT_CATEGORY,
    amount: gift.amount,
    frequency: 'oneTime',
    from: youngest ? { kind: 'age', personId: youngest.id, age: gift.age } : { kind: 'now' },
    essential: false,
    realGrowthPct: 0,
  }
}

const isGift = (item: ExpenseItem) => item.category === GIFT_CATEGORY && item.frequency === 'oneTime'

export function setLegacyGifts(plan: PlanV2, gifts: PlannedGift[]): PlanV2 {
  const others = plan.expenses.items.filter(item => !isGift(item))
  return { ...plan, expenses: { ...plan.expenses, items: [...others, ...gifts.map(g => giftToItem(plan, g))] } }
}

export function addLegacyGift(plan: PlanV2, age: number, id: string = newId('gift')): PlanV2 {
  const item = giftToItem(plan, { id, label: 'Kid gift', amount: 50000, age })
  return { ...plan, expenses: { ...plan.expenses, items: [...plan.expenses.items, item] } }
}

export function updateLegacyGift(
  plan: PlanV2,
  giftId: string,
  patch: Partial<Omit<PlannedGift, 'id'>>,
): PlanV2 {
  return {
    ...plan,
    expenses: {
      ...plan.expenses,
      items: plan.expenses.items.map(item => {
        if (item.id !== giftId) return item
        const next = { ...item }
        if (patch.label !== undefined) next.label = patch.label
        if (patch.amount !== undefined) next.amount = patch.amount
        if (patch.age !== undefined) next.from = giftToItem(plan, { id: item.id, label: '', amount: 0, age: patch.age }).from
        return next
      }),
    },
  }
}

export function removeExpenseItem(plan: PlanV2, itemId: string): PlanV2 {
  return { ...plan, expenses: { ...plan.expenses, items: plan.expenses.items.filter(i => i.id !== itemId) } }
}

export function setReplacementRate(plan: PlanV2, replacementRate: number): PlanV2 {
  return { ...plan, expenses: { ...plan.expenses, replacementRate } }
}

export function setInitialWithdrawalRate(plan: PlanV2, ratePct: number): PlanV2 {
  return { ...plan, drawdown: { ...plan.drawdown, strategy: { kind: 'initialPct', ratePct } } }
}

export function patchAssumptions(plan: PlanV2, patch: Partial<PlanV2['assumptions']>): PlanV2 {
  return { ...plan, assumptions: { ...plan.assumptions, ...patch } }
}
