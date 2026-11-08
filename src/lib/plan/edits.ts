import type { Person } from '@/types/person'
import type { PlannedGift } from '@/types/plan'
import {
  GIFT_CATEGORY,
  type AccountV2,
  type Debt,
  type ExpenseItem,
  type ExpensePhase,
  type Holding,
  type IncomeStream,
  type Property,
  type PersonV2,
  type PlanV2,
} from './schema'
import { stockValueCad } from './accountGroups'
import { createDefaultPerson } from './defaults'
import { newId } from './ids'
import { detachPersonTimePoints, youngestPerson } from './time'

// Pure plan transforms. The legacy usePeople/useAssumptions hooks map their v1
// operations onto these, so the v2 plan stays the single source of truth.

type PersonPatch = Partial<PersonV2>

export function patchPerson(plan: PlanV2, personId: string, patch: PersonPatch): PlanV2 {
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
    case 'STOCK':
      account = { ...base, type, holdings: [], salePlan: { kind: 'none' } }
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

// --- Generic account and income edits (v2 editors) -------------------------

export function patchAccount(plan: PlanV2, accountId: string, patch: Partial<AccountV2>): PlanV2 {
  return {
    ...plan,
    accounts: plan.accounts.map(a => (a.id === accountId ? ({ ...a, ...patch } as AccountV2) : a)),
  }
}

export function setAccountContributionRule(
  plan: PlanV2,
  accountId: string,
  patch: Partial<AccountV2['contributions'][number]>,
): PlanV2 {
  return {
    ...plan,
    accounts: plan.accounts.map(a => {
      if (a.id !== accountId) return a
      const [first, ...rest] = a.contributions
      const base = first ?? { amount: 0, indexed: false, to: { kind: 'retirement' as const, personId: a.ownerId, offset: 0 } }
      return { ...a, contributions: [{ ...base, ...patch }, ...rest] }
    }),
  }
}

export type IncomeTemplate = 'salary' | 'partTime' | 'dbPension' | 'rental' | 'windfall' | 'other'

export function newIncome(template: IncomeTemplate, ownerId: string, id: string = newId('income')): IncomeStream {
  const base = {
    id, ownerId, amount: 0, frequency: 'annual' as const, growth: { kind: 'cpi' as const, pct: 0 },
    taxTreatment: 'ordinary' as const,
  }
  const retirement = { kind: 'retirement' as const, personId: ownerId, offset: 0 }
  switch (template) {
    case 'salary':
      return { ...base, kind: 'employment', label: 'Salary', amount: 60000, to: retirement }
    case 'partTime':
      return { ...base, kind: 'employment', label: 'Part-time work', amount: 25000, from: retirement, to: { ...retirement, offset: 5 } }
    case 'dbPension':
      return { ...base, kind: 'dbPension', label: 'Employer pension', amount: 20000, from: retirement, db: { indexationPctOfCpi: 100, survivorPct: 60 } }
    case 'rental':
      return { ...base, kind: 'rental', label: 'Rental income (net)', amount: 12000 }
    case 'windfall':
      return { ...base, kind: 'windfall', label: 'Inheritance', amount: 100000, frequency: 'oneTime', from: { kind: 'age', personId: ownerId, age: 60 }, taxTreatment: 'nonTaxable', growth: { kind: 'cpi', pct: 0 } }
    case 'other':
      return { ...base, kind: 'other', label: 'Other income', amount: 5000 }
  }
}

export function addIncome(plan: PlanV2, income: IncomeStream): PlanV2 {
  return { ...plan, incomes: [...plan.incomes, income] }
}

export function patchIncome(plan: PlanV2, incomeId: string, patch: Partial<IncomeStream>): PlanV2 {
  return { ...plan, incomes: plan.incomes.map(i => (i.id === incomeId ? { ...i, ...patch } : i)) }
}

export function removeIncome(plan: PlanV2, incomeId: string): PlanV2 {
  return { ...plan, incomes: plan.incomes.filter(i => i.id !== incomeId) }
}

// --- Spending, real estate and debt edits ------------------------------------

export function patchExpenses(plan: PlanV2, patch: Partial<PlanV2['expenses']>): PlanV2 {
  return { ...plan, expenses: { ...plan.expenses, ...patch } }
}

export function addExpenseItem(plan: PlanV2, item: ExpenseItem): PlanV2 {
  return patchExpenses(plan, { items: [...plan.expenses.items, item] })
}

export function patchExpenseItem(plan: PlanV2, itemId: string, patch: Partial<ExpenseItem>): PlanV2 {
  return patchExpenses(plan, { items: plan.expenses.items.map(i => (i.id === itemId ? { ...i, ...patch } : i)) })
}

export function addExpensePhase(plan: PlanV2, phase: ExpensePhase): PlanV2 {
  return patchExpenses(plan, { phases: [...plan.expenses.phases, phase] })
}

export function patchExpensePhase(plan: PlanV2, phaseId: string, patch: Partial<ExpensePhase>): PlanV2 {
  return patchExpenses(plan, { phases: plan.expenses.phases.map(p => (p.id === phaseId ? { ...p, ...patch } : p)) })
}

export function removeExpensePhase(plan: PlanV2, phaseId: string): PlanV2 {
  return patchExpenses(plan, { phases: plan.expenses.phases.filter(p => p.id !== phaseId) })
}

// Switching to detailed mode seeds one living-expenses line from the simple
// target so the projection does not jump.
export function setExpenseMode(plan: PlanV2, mode: 'simple' | 'detailed', simpleTargetToday: number): PlanV2 {
  if (mode === plan.expenses.mode) return plan
  const hasRecurring = plan.expenses.items.some(i => i.frequency !== 'oneTime')
  if (mode === 'detailed' && !hasRecurring && simpleTargetToday > 0) {
    return patchExpenses(plan, {
      mode,
      items: [
        { id: newId('expense'), label: 'Living expenses', category: 'living', amount: Math.round(simpleTargetToday * 0.8 / 1000) * 1000, frequency: 'annual', essential: true, realGrowthPct: 0 },
        { id: newId('expense'), label: 'Travel & leisure', category: 'leisure', amount: Math.round(simpleTargetToday * 0.2 / 1000) * 1000, frequency: 'annual', essential: false, realGrowthPct: 0 },
        ...plan.expenses.items,
      ],
    })
  }
  return patchExpenses(plan, { mode })
}

export function setSpendingStrategy(plan: PlanV2, strategy: PlanV2['drawdown']['strategy']): PlanV2 {
  return { ...plan, drawdown: { ...plan.drawdown, strategy } }
}

export function addProperty(plan: PlanV2, property: Property): PlanV2 {
  return { ...plan, properties: [...plan.properties, property] }
}

export function patchProperty(plan: PlanV2, propertyId: string, patch: Partial<Property>): PlanV2 {
  return { ...plan, properties: plan.properties.map(p => (p.id === propertyId ? { ...p, ...patch } : p)) }
}

export function removeProperty(plan: PlanV2, propertyId: string): PlanV2 {
  return {
    ...plan,
    properties: plan.properties.filter(p => p.id !== propertyId),
    debts: plan.debts.map(d => (d.propertyId === propertyId ? { ...d, propertyId: undefined } : d)),
  }
}

export function addDebt(plan: PlanV2, debt: Debt): PlanV2 {
  return { ...plan, debts: [...plan.debts, debt] }
}

export function patchDebt(plan: PlanV2, debtId: string, patch: Partial<Debt>): PlanV2 {
  return { ...plan, debts: plan.debts.map(d => (d.id === debtId ? { ...d, ...patch } : d)) }
}

export function removeDebt(plan: PlanV2, debtId: string): PlanV2 {
  return { ...plan, debts: plan.debts.filter(d => d.id !== debtId) }
}

export function patchDrawdown(plan: PlanV2, patch: Partial<PlanV2['drawdown']>): PlanV2 {
  return { ...plan, drawdown: { ...plan.drawdown, ...patch } }
}

export function patchEstate(plan: PlanV2, patch: Partial<PlanV2['estate']>): PlanV2 {
  return { ...plan, estate: { ...plan.estate, ...patch } }
}

export function patchSimulation(plan: PlanV2, patch: Partial<PlanV2['assumptions']['simulation']>): PlanV2 {
  return { ...plan, assumptions: { ...plan.assumptions, simulation: { ...plan.assumptions.simulation, ...patch } } }
}

// --- Stock portfolio edits ---------------------------------------------------
// The account balance always equals the holdings' market value, so totals and
// summaries that read `balance` stay correct.

type StockAccount = Extract<AccountV2, { type: 'STOCK' }>

function updateStockAccount(plan: PlanV2, accountId: string, update: (a: StockAccount) => StockAccount): PlanV2 {
  return {
    ...plan,
    accounts: plan.accounts.map(a => {
      if (a.id !== accountId || a.type !== 'STOCK') return a
      const next = update(a)
      return { ...next, balance: stockValueCad(next.holdings, plan.assumptions.usdCad.rate) }
    }),
  }
}

// Changing the rate revalues every stock account.
export function setUsdCad(plan: PlanV2, rate: number, asOf?: string): PlanV2 {
  if (!(rate > 0)) return plan
  return {
    ...plan,
    assumptions: { ...plan.assumptions, usdCad: { rate, asOf } },
    accounts: plan.accounts.map(a => (a.type === 'STOCK' ? { ...a, balance: stockValueCad(a.holdings, rate) } : a)),
  }
}

export function newHolding(id: string = newId('holding')): Holding {
  return {
    id, symbol: '', shares: 100, priceUsd: 50, dividendYieldPct: 0, dividendType: 'eligible',
    growthPct: { bear: 0, base: 5, bull: 10 }, volatilityPct: 30, rsuGrants: [], sellToCover: true,
  }
}

export function addHolding(plan: PlanV2, accountId: string, holding: Holding = newHolding()): PlanV2 {
  return updateStockAccount(plan, accountId, a => ({ ...a, holdings: [...a.holdings, holding] }))
}

export function patchHolding(plan: PlanV2, accountId: string, holdingId: string, patch: Partial<Holding>): PlanV2 {
  return updateStockAccount(plan, accountId, a => ({ ...a, holdings: a.holdings.map(h => (h.id === holdingId ? { ...h, ...patch } : h)) }))
}

export function removeHolding(plan: PlanV2, accountId: string, holdingId: string): PlanV2 {
  return updateStockAccount(plan, accountId, a => ({ ...a, holdings: a.holdings.filter(h => h.id !== holdingId) }))
}

export function setStockSalePlan(plan: PlanV2, accountId: string, salePlan: StockAccount['salePlan']): PlanV2 {
  return updateStockAccount(plan, accountId, a => ({ ...a, salePlan }))
}

export function setStockScenario(plan: PlanV2, stockScenario: PlanV2['assumptions']['stockScenario']): PlanV2 {
  return { ...plan, assumptions: { ...plan.assumptions, stockScenario } }
}

// Apply fetched quotes (already converted to USD) to every holding with that
// symbol, and the Bank of Canada USD→CAD rate fetched with them.
export function applyQuotes(
  plan: PlanV2,
  prices: Record<string, { price: number; currency: string; fxToCad: number; priceUsd: number; asOf: string; source: string }>,
  fetchedAt: string,
  usdCad?: { rate: number; asOf?: string },
): PlanV2 {
  let next = usdCad ? setUsdCad(plan, usdCad.rate, usdCad.asOf) : plan
  for (const account of plan.accounts) {
    if (account.type !== 'STOCK') continue
    for (const h of account.holdings) {
      const quote = prices[h.symbol.trim().toUpperCase()]
      if (!quote) continue
      next = patchHolding(next, account.id, h.id, {
        priceUsd: Math.round(quote.priceUsd * 10000) / 10000,
        lastQuote: { price: quote.price, currency: quote.currency, fxToCad: quote.fxToCad, asOf: quote.asOf, fetchedAt, source: quote.source },
      })
    }
  }
  return next
}
