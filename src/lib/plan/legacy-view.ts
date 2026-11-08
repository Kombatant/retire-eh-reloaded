import type { Account, Person } from '@/types/person'
import type { PlanAssumptions, PlannedGift, RetirementPlan } from '@/types/plan'
import { estimateCppAt65, estimateCppFromHistory } from '@/lib/benefits/cpp'
import { GIFT_CATEGORY, type PersonV2, type PlanV2, type UiPrefs } from './schema'
import { resolveYear, youngestPerson } from './time'

// Used for the goal when the strategy has no rate of its own.
export const GUIDELINE_WITHDRAWAL_RATE = 4

// Read-only projection of a v2 plan into the v1 shapes the current components
// and engine consume. This keeps the UI unchanged while the model evolves.

// The person's main salary today (first annual employment stream).
export function primarySalary(plan: Pick<PlanV2, 'incomes'>, personId: string): number {
  return plan.incomes.find(i => i.ownerId === personId && i.kind === 'employment' && i.frequency === 'annual')?.amount ?? 0
}

// Age-65 CPP/QPP in plan-start dollars. `salary` is the default for
// "typical earnings" in the work-history estimate.
export function cppAmountAt65(person: PersonV2, salary = 0): number {
  if (person.cpp.mode === 'amount') return person.cpp.amountAt65
  if (person.cpp.mode === 'history') {
    return estimateCppFromHistory({
      birthYear: person.birthYear,
      retirementAge: person.retirementAge,
      startedWorkingYear: person.cpp.startedWorkingYear,
      typicalEarnings: person.cpp.typicalEarnings ?? salary,
      yearsNotWorking: person.cpp.yearsNotWorking,
      childRearingYears: person.cpp.childRearingYears,
    }).amountAt65
  }
  return estimateCppAt65({
    averageEarningsRatioPct: person.cpp.averageEarningsRatioPct,
    contributoryYears: person.cpp.contributoryYears,
    birthYear: person.birthYear,
    retirementAge: person.retirementAge,
  })
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

// The v1 fields map to a person's primary (first) stream of each kind, so
// extra streams such as part-time work after retirement do not inflate the
// income-replacement target.
function primaryIncome(plan: PlanV2, personId: string, kind: 'employment' | 'dbPension'): number {
  return plan.incomes.find(i => i.ownerId === personId && i.kind === kind && i.frequency === 'annual')?.amount ?? 0
}

export function toLegacyPeople(plan: PlanV2, nowYear: number): Person[] {
  return plan.people.map(p => ({
    id: p.id,
    name: p.name,
    currentAge: nowYear - p.birthYear,
    retirementAge: p.retirementAge,
    annualIncome: primaryIncome(plan, p.id, 'employment'),
    annualPension: primaryIncome(plan, p.id, 'dbPension'),
    annualCpp: cppAmountAt65(p, primarySalary(plan, p.id)),
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

export function toLegacyAssumptions(plan: PlanV2, uiPrefs: Pick<UiPrefs, 'showRealValues'>, nowYear: number): PlanAssumptions {
  const strategy = plan.drawdown.strategy
  return {
    expectedReturn: plan.assumptions.expectedReturn,
    inflationRate: plan.assumptions.inflationRate,
    replacementRate: plan.expenses.replacementRate,
    withdrawalRate: strategy.kind === 'initialPct' || strategy.kind === 'pctPortfolio' ? strategy.ratePct
      : strategy.kind === 'guytonKlinger' ? strategy.initialRatePct
        : GUIDELINE_WITHDRAWAL_RATE,
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
