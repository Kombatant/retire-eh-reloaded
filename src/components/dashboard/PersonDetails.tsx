import { usePlanStore } from '@/contexts/PlanStoreContext'
import { patchPerson } from '@/lib/plan/edits'
import { PROVINCES, type PersonV2, type ProvinceCode } from '@/lib/plan/schema'
import { provinceName } from '@/lib/tax'
import { cppAmountAt65, primarySalary } from '@/lib/plan/legacy-view'
import { estimateCppFromHistory } from '@/lib/benefits/cpp'
import { getCppIncomeAtAge } from '@/lib/calculations'
import { formatMoney } from '@/lib/formatting'
import { IntegerInput } from '@/components/ui/IntegerInput'
import { NumberInput } from '@/components/ui/NumberInput'
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
      <CppSection person={person} salary={primarySalary(activePlan, person.id)} update={update} />
      <div className="sm:col-span-2">
        <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
          <input
            type="checkbox"
            checked={person.room !== undefined}
            onChange={(e) => update({ room: e.target.checked ? { rrsp: 0, tfsa: 0 } : undefined })}
            className="accent-indigo-500"
          />
          Track RRSP and TFSA contribution room
          <InfoTooltip text="Enter your unused room from your CRA Notice of Assessment or My Account. The plan adds new room each year (18% of last year's earnings for RRSPs, the annual TFSA limit plus last year's withdrawals) and warns if planned contributions exceed it." />
        </label>
        {person.room && (
          <div className="grid grid-cols-2 gap-2 mt-2">
            <label>
              <span className={labelClass}>Unused RRSP room</span>
              <NumberInput value={person.room.rrsp ?? 0} onChange={(v) => update({ room: { ...person.room, rrsp: v } })} step={1000} min={0} ariaLabel="Unused RRSP room" />
            </label>
            <label>
              <span className={labelClass}>Unused TFSA room</span>
              <NumberInput value={person.room.tfsa ?? 0} onChange={(v) => update({ room: { ...person.room, tfsa: v } })} step={1000} min={0} ariaLabel="Unused TFSA room" />
            </label>
          </div>
        )}
      </div>
    </div>
  )
}

// CPP/QPP: the statement amount, or an estimate from a few questions about
// the person's work history.
function CppSection({ person, salary, update }: { person: PersonV2; salary: number; update: (patch: Partial<PersonV2>) => void }) {
  const plan = person.province === 'QC' ? 'QPP' : 'CPP'
  const cpp = person.cpp
  const setMode = (mode: string) => {
    if (mode === cpp.mode) return
    if (mode === 'amount') return update({ cpp: { mode: 'amount', amountAt65: Math.round(cppAmountAt65(person, salary)) } })
    if (mode === 'history') {
      return update({ cpp: { mode: 'history', startedWorkingYear: person.birthYear + 22, yearsNotWorking: 0, childRearingYears: 0 } })
    }
    update({ cpp: { mode: 'earnings', averageEarningsRatioPct: 100, contributoryYears: 39 } })
  }
  const estimate = cpp.mode === 'history'
    ? estimateCppFromHistory({
        birthYear: person.birthYear,
        retirementAge: person.retirementAge,
        startedWorkingYear: cpp.startedWorkingYear,
        typicalEarnings: cpp.typicalEarnings ?? salary,
        yearsNotWorking: cpp.yearsNotWorking,
        childRearingYears: cpp.childRearingYears,
      })
    : null
  const atStart = getCppIncomeAtAge(cppAmountAt65(person, salary), person.cppStartAge, person.cppStartAge)

  return (
    <div className="sm:col-span-2 space-y-2">
      <label className="block">
        <span className={labelClass}>
          How should we work out your {plan} pension?
          <InfoTooltip text={`Your ${person.province === 'QC' ? 'Retraite Québec' : 'My Service Canada Account'} statement shows your exact estimate. If you don't have it, answer a few questions about your work history and we'll calculate it with the ${plan} benefit formula.`} />
        </span>
        <select value={cpp.mode} onChange={(e) => setMode(e.target.value)} className={selectClass}>
          <option value="history">Estimate it from my work history</option>
          <option value="amount">I have my statement amount</option>
          {cpp.mode === 'earnings' && <option value="earnings">Advanced: % of YMPE and years</option>}
        </select>
      </label>

      {cpp.mode === 'history' && estimate && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg bg-gray-50 dark:bg-gray-800/40 p-3">
          <label>
            <span className={labelClass}>Year you started working in Canada</span>
            <IntegerInput
              value={cpp.startedWorkingYear}
              onChange={(v) => update({ cpp: { ...cpp, startedWorkingYear: v } })}
              min={1940}
              max={2100}
              className={inputClass}
              ariaLabel="Year you started working in Canada"
            />
          </label>
          <label>
            <span className={labelClass}>
              Typical yearly earnings (today's $)
              <InfoTooltip text={`Your usual employment or self-employment income over your career, in today's dollars. Leave blank to use your current salary. ${plan} counts earnings up to $85,000 (2026); the base pension uses earnings up to $74,600.`} />
            </span>
            <NumberInput
              value={cpp.typicalEarnings ?? 0}
              onChange={(v) => update({ cpp: { ...cpp, typicalEarnings: v > 0 ? v : undefined } })}
              step={5000}
              min={0}
              ariaLabel="Typical yearly earnings"
            />
            {cpp.typicalEarnings === undefined && (
              <span className="text-[11px] text-gray-500 dark:text-gray-400">Using your salary: ${formatMoney(salary)}</span>
            )}
          </label>
          <label>
            <span className={labelClass}>
              Years without earnings
              <InfoTooltip text="Years after you started working (and before 65) when you had no or very little employment income: living abroad, full-time school, unemployment, sabbaticals." />
            </span>
            <IntegerInput
              value={cpp.yearsNotWorking}
              onChange={(v) => update({ cpp: { ...cpp, yearsNotWorking: v } })}
              min={0}
              max={47}
              className={inputClass}
              ariaLabel="Years without earnings"
            />
          </label>
          <label>
            <span className={labelClass}>
              Years at home with a child under 7
              <InfoTooltip text="Years you stayed home or earned less while caring for a child under 7. These are left out of the calculation instead of lowering your average (the child-rearing provision)." />
            </span>
            <IntegerInput
              value={cpp.childRearingYears}
              onChange={(v) => update({ cpp: { ...cpp, childRearingYears: v } })}
              min={0}
              max={47}
              className={inputClass}
              ariaLabel="Years caring for a child under 7"
            />
          </label>
          <div className="sm:col-span-2 text-sm text-gray-800 dark:text-gray-200">
            Estimated {plan} at 65: <strong>${formatMoney(estimate.amountAt65)}/yr</strong>
            {person.cppStartAge !== 65 && <> · starting at {person.cppStartAge}: <strong>${formatMoney(atStart)}/yr</strong></>}
            <span className="text-gray-500 dark:text-gray-400"> (today's dollars)</span>
          </div>
          <p className="sm:col-span-2 text-[11px] text-gray-500 dark:text-gray-400">
            {estimate.workingYears} working years until {Math.min(person.retirementAge, 65)}; your best {estimate.countedYears} count.
            Earnings at {Math.round(estimate.earningsRatio * 100)}% of the maximum.
            Base ${formatMoney(estimate.base)} + enhancement since 2019 ${formatMoney(estimate.firstEnhancement)}
            {estimate.secondEnhancement > 0 && <> + earnings above $74,600 since 2024 ${formatMoney(estimate.secondEnhancement)}</>}.
            Assumes your earnings kept pace with wages. Your official statement is more accurate.
          </p>
        </div>
      )}

      {cpp.mode === 'amount' && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          Enter the age-65 amount from your statement in "Annual {plan} (at age 65)" above.
        </p>
      )}

      {cpp.mode === 'earnings' && (
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className={labelClass}>Average earnings (% of YMPE)</span>
            <IntegerInput value={cpp.averageEarningsRatioPct} onChange={(v) => update({ cpp: { ...cpp, averageEarningsRatioPct: v } })} min={0} max={100} className={inputClass} ariaLabel="Average earnings as percent of YMPE" />
          </label>
          <label>
            <span className={labelClass}>Years contributing (18–65)</span>
            <IntegerInput value={cpp.contributoryYears} onChange={(v) => update({ cpp: { ...cpp, contributoryYears: v } })} min={0} max={47} className={inputClass} ariaLabel="Years contributing" />
          </label>
          <p className="col-span-2 text-[11px] text-gray-500 dark:text-gray-400">Estimated pension at 65: ${formatMoney(cppAmountAt65(person, salary))}/yr.</p>
        </div>
      )}
    </div>
  )
}
