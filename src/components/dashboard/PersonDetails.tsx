import { usePlanStore } from '@/contexts/PlanStoreContext'
import { patchPerson } from '@/lib/plan/edits'
import { PROVINCES, type PersonV2, type ProvinceCode } from '@/lib/plan/schema'
import { provinceName } from '@/lib/tax'
import { cppAmountAt65 } from '@/lib/plan/legacy-view'
import { formatMoney } from '@/lib/formatting'
import { IntegerInput } from '@/components/ui/IntegerInput'
import { InfoTooltip } from './InfoTooltip'

const labelClass = 'block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1'
const selectClass = 'w-full px-2.5 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20'
const inputClass = 'w-full px-2.5 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20'

// Residence and benefit details that only exist in the v2 plan model.
export function PersonDetails({ personId }: { personId: string }) {
  const { activePlan, updateActivePlan } = usePlanStore()
  const person = activePlan.people.find(p => p.id === personId)
  if (!person) return null

  const update = (patch: Partial<PersonV2>) => updateActivePlan(plan => patchPerson(plan, personId, patch))
  const estimating = person.cpp.mode === 'earnings'

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-gray-200 dark:border-gray-700 pt-3">
      <div>
        <label className={labelClass}>
          Province or territory
          <InfoTooltip text="Where you live (and file taxes). Used for provincial income tax, credits, and whether CPP or QPP applies." />
        </label>
        <select
          value={person.province}
          onChange={(e) => update({ province: e.target.value as ProvinceCode })}
          className={selectClass}
        >
          {PROVINCES.map(code => (
            <option key={code} value={code}>{provinceName(code)}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass}>
          Plan to age
          <InfoTooltip text="Life expectancy used for the plan horizon. Planning to 95 is a common conservative choice." />
        </label>
        <IntegerInput
          value={person.lifeExpectancy}
          onChange={(v) => update({ lifeExpectancy: v })}
          min={60}
          max={110}
          className={inputClass}
          ariaLabel="Plan to age"
        />
      </div>
      <div>
        <label className={labelClass}>
          Years in Canada after 18
          <InfoTooltip text="OAS is 1/40 of the full pension for each year you lived in Canada after age 18, with a minimum of 10 years to qualify. 40 or more years gives the full pension." />
        </label>
        <IntegerInput
          value={person.oas.yearsInCanadaAfter18}
          onChange={(v) => update({ oas: { ...person.oas, yearsInCanadaAfter18: v } })}
          min={0}
          max={47}
          className={inputClass}
          ariaLabel="Years in Canada after 18"
        />
      </div>
      <div>
        <label className={labelClass}>
          {person.province === 'QC' ? 'QPP' : 'CPP'} amount
          <InfoTooltip text="Enter the age-65 amount from your Service Canada (or Retraite Québec) statement, or estimate it from your earnings history." />
        </label>
        <select
          value={person.cpp.mode}
          onChange={(e) => update({
            cpp: e.target.value === 'earnings'
              ? { mode: 'earnings', averageEarningsRatioPct: 100, contributoryYears: 39 }
              : { mode: 'amount', amountAt65: Math.round(cppAmountAt65(person)) },
          })}
          className={selectClass}
        >
          <option value="amount">From my statement</option>
          <option value="earnings">Estimate from earnings</option>
        </select>
      </div>
      {estimating && person.cpp.mode === 'earnings' && (
        <>
          <div>
            <label className={labelClass}>
              Average earnings (% of YMPE)
              <InfoTooltip text="Your typical earnings as a percentage of the Year's Maximum Pensionable Earnings ($74,600 in 2026). Earning at or above the YMPE every year is 100%." />
            </label>
            <IntegerInput
              value={person.cpp.averageEarningsRatioPct}
              onChange={(v) => update({ cpp: { ...person.cpp, mode: 'earnings', averageEarningsRatioPct: v } as PersonV2['cpp'] })}
              min={0}
              max={100}
              className={inputClass}
              ariaLabel="Average earnings as percent of YMPE"
            />
          </div>
          <div>
            <label className={labelClass}>
              Years contributing (18–65)
              <InfoTooltip text="Years with CPP/QPP earnings between 18 and 65. About 39 years gives a full pension after the general drop-out." />
            </label>
            <IntegerInput
              value={person.cpp.contributoryYears}
              onChange={(v) => update({ cpp: { ...person.cpp, mode: 'earnings', contributoryYears: v } as PersonV2['cpp'] })}
              min={0}
              max={47}
              className={inputClass}
              ariaLabel="Years contributing"
            />
          </div>
          <p className="sm:col-span-2 text-[11px] text-gray-500 dark:text-gray-400">
            Estimated pension at 65: ${formatMoney(cppAmountAt65(person))}/yr in today's dollars, including the CPP enhancement earned since 2019.
          </p>
        </>
      )}
    </div>
  )
}
