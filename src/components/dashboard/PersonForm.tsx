import { useEffect } from 'react'
import type { Person } from '@/types/household'
import { InfoTooltip } from './InfoTooltip'
import { AccountsSection } from './AccountsSection'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { PersonDetails } from './PersonDetails'
import { NumberInput } from '@/components/ui/NumberInput'
import { validateAge, validateRetirementAge } from '@/lib/validation'
import {
  CPP_MIN_START_AGE,
  CPP_MAX_START_AGE,
  OAS_MIN_START_AGE,
  OAS_MAX_START_AGE,
  getCppIncomeAtAge,
  getOasIncomeAtAge,
} from '@/lib/calculations'
import { OAS_MAX_ANNUAL_2026 } from '@/lib/tax'
import { formatMoney } from '@/lib/formatting'

interface PersonFormProps {
  people: Person[]
  selectedPersonId: string | null
  onSelect: (id: string) => void
  onUpdatePerson: (id: string, field: keyof Person, value: string | number) => void
  onUpdatePersonAnnualIncome: (personId: string, annualIncome: number) => void
  onUpdatePersonAnnualPension: (personId: string, annualPension: number) => void
  onDeletePerson: (id: string) => void
}

export function PersonForm({
  people,
  selectedPersonId,
  onSelect,
  onUpdatePerson,
  onUpdatePersonAnnualIncome,
  onUpdatePersonAnnualPension,
  onDeletePerson,
}: PersonFormProps) {
  const { activePlan } = usePlanStore()
  useEffect(() => {
    if (people.length > 0 && (!selectedPersonId || !people.find(p => p.id === selectedPersonId))) {
      onSelect(people[0].id)
    }
  }, [people, selectedPersonId, onSelect])

  const person = people.find(p => p.id === selectedPersonId) || people[0]
  if (!person) return null

  const cppStartAge = person.cppStartAge ?? 65
  const cppMode = activePlan.people.find(p => p.id === person.id)?.cpp.mode ?? 'amount'
  const oasStartAge = person.oasStartAge ?? 65

  const canDeletePerson = people.length > 1

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Name</label>
          <input
            type="text"
            value={person.name}
            onChange={(e) => onUpdatePerson(person.id, 'name', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-white font-medium focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            Annual Income
            <InfoTooltip text="Your current pre-tax annual income (used to calculate your retirement income target)" />
          </label>
          <NumberInput
            value={person.annualIncome || 0}
            onChange={(val) => onUpdatePersonAnnualIncome(person.id, val)}
            step={5000}
            min={0}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Current Age</label>
          <input
            type="number"
            min={0}
            max={100}
            value={person.currentAge}
            onChange={(e) => onUpdatePerson(person.id, 'currentAge', e.target.valueAsNumber)}
            className={`w-full px-2.5 py-1.5 text-sm border rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-1 ${
              validateAge(person.currentAge)
                ? 'border-red-300 dark:border-red-600 focus:border-red-500 focus:ring-red-500/20'
                : 'border-gray-300 dark:border-gray-600 focus:border-indigo-500 focus:ring-indigo-500/20'
            }`}
          />
          {validateAge(person.currentAge) && (
            <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">{validateAge(person.currentAge)}</p>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Retirement Age</label>
          <input
            type="number"
            min={person.currentAge + 1}
            max={100}
            value={person.retirementAge}
            onChange={(e) => onUpdatePerson(person.id, 'retirementAge', e.target.valueAsNumber)}
            className={`w-full px-2.5 py-1.5 text-sm border rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-1 ${
              validateRetirementAge(person.retirementAge, person.currentAge)
                ? 'border-red-300 dark:border-red-600 focus:border-red-500 focus:ring-red-500/20'
                : 'border-gray-300 dark:border-gray-600 focus:border-emerald-500 focus:ring-emerald-500/20'
            }`}
          />
          {validateRetirementAge(person.retirementAge, person.currentAge) && (
            <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">{validateRetirementAge(person.retirementAge, person.currentAge)}</p>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            Annual CPP (at age 65)
            <InfoTooltip text="Your estimated Canada Pension Plan income per year at age 65. Defaults to the 2026 maximum (~$18,100/yr); lower it if you have fewer than ~39 years of maximum contributions. The app adjusts this amount for your chosen CPP start age. Capped at $25,000/yr." />
          </label>
          {cppMode === 'amount' ? (
            <NumberInput
            value={person.annualCpp || 0}
            onChange={(val) => onUpdatePerson(person.id, 'annualCpp', val)}
            step={1000}
            min={0}
            max={25000}
          />
          ) : (
            <div className="w-full px-3 py-2 text-sm rounded border border-dashed border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300">
              ${formatMoney(person.annualCpp ?? 0)} <span className="text-xs text-gray-500 dark:text-gray-400">estimated below</span>
            </div>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            CPP Start Age
            <InfoTooltip text="The age you plan to start CPP (60 to 70). Starting before 65 permanently reduces the amount by 0.6% per month; starting after 65 permanently increases it by 0.7% per month. CPP is not counted as retirement income before this age." />
          </label>
          <select
            value={cppStartAge}
            onChange={(e) => onUpdatePerson(person.id, 'cppStartAge', Number(e.target.value))}
            className="w-full px-2.5 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20"
          >
            {Array.from({ length: CPP_MAX_START_AGE - CPP_MIN_START_AGE + 1 }, (_, i) => CPP_MIN_START_AGE + i).map((age) => {
              const adjusted = getCppIncomeAtAge(person.annualCpp, age, age)
              return (
                <option key={age} value={age}>
                  {adjusted > 0 ? `${age} ($${formatMoney(adjusted)}/yr)` : age}
                </option>
              )
            })}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            OAS Start Age
            <InfoTooltip text="The age you plan to start Old Age Security (65 to 70). Deferring past 65 permanently increases the amount by 0.6% per month (7.2% per year), up to age 70. OAS is not counted as retirement income before this age." />
          </label>
          <select
            value={oasStartAge}
            onChange={(e) => onUpdatePerson(person.id, 'oasStartAge', Number(e.target.value))}
            className="w-full px-2.5 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20"
          >
            {Array.from({ length: OAS_MAX_START_AGE - OAS_MIN_START_AGE + 1 }, (_, i) => OAS_MIN_START_AGE + i).map((age) => {
              const adjusted = getOasIncomeAtAge(OAS_MAX_ANNUAL_2026, age, age)
              return (
                <option key={age} value={age}>
                  {age} (${formatMoney(adjusted)}/yr)
                </option>
              )
            })}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            Annual Employer Pension (at retirement)
            <InfoTooltip text="Estimated workplace pension income per year once retired (defined benefit or annuity). Leave at 0 if you have no employer pension." />
          </label>
          <NumberInput
            value={person.annualPension || 0}
            onChange={(val) => onUpdatePersonAnnualPension(person.id, val)}
            step={1000}
            min={0}
          />
        </div>
      </div>

      <PersonDetails personId={person.id} />

      {person.retirementAge <= person.currentAge && !validateRetirementAge(person.retirementAge, person.currentAge) && (
        <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-1.5 rounded border border-amber-200 dark:border-amber-800">
          Retirement age must be greater than current age
        </div>
      )}

      <AccountsSection personId={person.id} />

      {canDeletePerson && (
        <div className="flex justify-end pt-2">
          <button
            onClick={() => onDeletePerson(person.id)}
            className="text-xs text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
          >
            - delete person
          </button>
        </div>
      )}
    </div>
  )
}
