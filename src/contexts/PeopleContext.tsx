import type { Person } from '@/types/person'
import { usePlanStore } from './PlanStoreContext'
import {
  addAccount,
  addPerson,
  deleteAccount,
  deletePerson,
  setAccountAnnualContribution,
  setAccountBalance,
  setIncomeAmount,
  setLegacyGifts,
  updateLegacyPersonField,
} from '@/lib/plan/edits'
import { migrateV1ToV2 } from '@/lib/plan/migrate'
import { newId } from '@/lib/plan/ids'

// v1-shaped people API over the v2 plan store. Components written against the
// original Person model keep working while new UI talks to the store directly.
export function usePeople() {
  const store = usePlanStore()
  const { legacyPeople: people, updateActivePlan, nowYear, now } = store

  return {
    people,
    setPeople: (newPeople: Person[]) => {
      const gifts = store.legacyAssumptions.plannedGifts
      updateActivePlan(plan => {
        // Rebuild people-owned data from the v1 records; plan-level settings stay.
        try {
          const { plan: migrated } = migrateV1ToV2(
            { version: '1.0', assumptions: store.legacyAssumptions, people: newPeople },
            { now, id: plan.id, name: plan.name },
          )
          const rebuilt = { ...plan, people: migrated.people, accounts: migrated.accounts, incomes: migrated.incomes }
          // Re-anchor gifts to the new youngest person so their ages are kept.
          return setLegacyGifts(rebuilt, gifts)
        } catch {
          return plan
        }
      })
    },
    selectedPersonId: store.selectedPersonId,
    setSelectedPersonId: store.setSelectedPersonId,
    addPerson: () => {
      const id = newId('person')
      updateActivePlan(plan => addPerson(plan, now, id))
      store.setSelectedPersonId(id)
    },
    deletePerson: (id: string) => updateActivePlan(plan => deletePerson(plan, id, nowYear)),
    updatePerson: (id: string, field: keyof Person, value: string | number) =>
      updateActivePlan(plan => updateLegacyPersonField(plan, id, field, value, nowYear)),
    updatePersonAnnualIncome: (personId: string, annualIncome: number) =>
      updateActivePlan(plan => setIncomeAmount(plan, personId, 'employment', annualIncome)),
    updatePersonAnnualPension: (personId: string, annualPension: number) =>
      updateActivePlan(plan => setIncomeAmount(plan, personId, 'dbPension', annualPension)),
    addAccount: (personId: string, type: 'RRSP' | 'TFSA') =>
      updateActivePlan(plan => addAccount(plan, personId, type)),
    deleteAccount: (_personId: string, accountId: string) => updateActivePlan(plan => deleteAccount(plan, accountId)),
    updateAccountBalance: (_personId: string, accountId: string, balance: number) =>
      updateActivePlan(plan => setAccountBalance(plan, accountId, balance)),
    updateAccountContribution: (_personId: string, accountId: string, annualContribution: number) =>
      updateActivePlan(plan => setAccountAnnualContribution(plan, accountId, annualContribution)),
  }
}
