import type { Account, Person } from '@/types/person'
import type { PlanAssumptions, PlannedGift, RetirementPlan } from '@/types/plan'
import { GIFT_CATEGORY, MAX_CPP_ANNUAL_2026, type PersonV2, type PlanV2, type UiPrefs } from './schema'
import { resolveYear, youngestPerson } from './time'

// Read-only projection of a v2 plan into the v1 shapes the current components
// and engine consume. This keeps the UI unchanged while the model evolves.

export function cppAmountAt65(person: PersonV2): number {
  if (person.cpp.mode === 'amount') return person.cpp.amountAt65
  // Rough placeholder until the earnings-based CPP calculator lands: scale the
  // maximum by earnings ratio and the share of a full 39-year contributory period.
  const yearsFactor = Math.min(1, person.cpp.contributoryYears / 39)
  return MAX_CPP_ANNUAL_2026 * (person.cpp.averageEarningsRatioPct / 100) * yearsFactor
}

function legacyAccounts(plan: PlanV2, personId: string): Account[] {
  return plan.accounts
    .filter(a => a.ownerId === personId && (a.type === 'RRSP' || a.type === 'TFSA'))
    .map(a => ({
      id: a.id,
      type: a.type as 'RRSP' | 'TFSA',
      balance: a.balance,
      annualContribution: a.contributions[0]?.amount ?? 0,
    }))
}

function sumIncome(plan: PlanV2, personId: string, kind: 'employment' | 'dbPension'): number {
  return plan.incomes
    .filter(i => i.ownerId === personId && i.kind === kind && i.frequency === 'annual')
    .reduce((sum, i) => sum + i.amount, 0)
}

export function toLegacyPeople(plan: PlanV2, nowYear: number): Person[] {
  return plan.people.map(p => ({
    id: p.id,
    name: p.name,
    currentAge: nowYear - p.birthYear,
    retirementAge: p.retirementAge,
    annualIncome: sumIncome(plan, p.id, 'employment'),
    annualPension: sumIncome(plan, p.id, 'dbPension'),
    annualCpp: cppAmountAt65(p),
    cppStartAge: p.cppStartAge,
    oasStartAge: p.oas.startAge,
    accounts: legacyAccounts(plan, p.id),
  }))
}

// v1 gift ages live on the household axis, which is the youngest person's age.
export function toLegacyGifts(plan: PlanV2, nowYear: number): PlannedGift[] {
  const youngest = youngestPerson(plan.people)
  if (!youngest) return []
  return plan.expenses.items
    .filter(item => item.category === GIFT_CATEGORY && item.frequency === 'oneTime')
    .map(item => ({
      id: item.id,
      label: item.label || 'Gift',
      amount: item.amount,
      age: resolveYear(item.from, plan.people, nowYear, nowYear) - youngest.birthYear,
    }))
}

export function toLegacyAssumptions(plan: PlanV2, uiPrefs: UiPrefs, nowYear: number): PlanAssumptions {
  const strategy = plan.drawdown.strategy
  return {
    expectedReturn: plan.assumptions.expectedReturn,
    inflationRate: plan.assumptions.inflationRate,
    replacementRate: plan.expenses.replacementRate,
    withdrawalRate: strategy.kind === 'initialPct' ? strategy.ratePct : 4,
    showRealValues: uiPrefs.showRealValues,
    plannedGifts: toLegacyGifts(plan, nowYear),
    workingMarginalTaxRate: plan.assumptions.workingMarginalTaxRate,
    reinvestRrspRefund: plan.assumptions.reinvestRrspRefund,
  }
}

export function toLegacyPlan(plan: PlanV2, uiPrefs: UiPrefs, nowYear: number): RetirementPlan {
  return {
    version: '1.0',
    assumptions: toLegacyAssumptions(plan, uiPrefs, nowYear),
    people: toLegacyPeople(plan, nowYear),
  }
}
