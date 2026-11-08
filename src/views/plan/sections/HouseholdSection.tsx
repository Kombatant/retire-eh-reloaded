import { useEffect } from 'react'
import { ArrowRight, UserPlus, Trash2 } from 'lucide-react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { useRoute } from '@/contexts/RouteContext'
import { useDetailLevel } from '@/hooks/useDetailLevel'
import { addPerson, deletePerson, patchPerson, updateLegacyPersonField } from '@/lib/plan/edits'
import { PROVINCES, type PersonV2, type ProvinceCode } from '@/lib/plan/schema'
import { cppAmountAt65, primarySalary } from '@/lib/plan/legacy-view'
import { estimateCppFromHistory } from '@/lib/benefits/cpp'
import {
  CPP_MIN_START_AGE, maxPensionStartAge, OAS_MAX_START_AGE, OAS_MIN_START_AGE, getCppIncomeAtAge, getOasIncomeAtAge,
} from '@/lib/calculations'
import { OAS_MAX_ANNUAL_2026, provinceName } from '@/lib/tax'
import { newId } from '@/lib/plan/ids'
import { money } from '@/lib/formatting'
import { validateRetirementAge } from '@/lib/validation'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Select, TextInput } from '@/components/ui/inputs'
import { IntegerInput } from '@/components/ui/IntegerInput'
import { NumberInput } from '@/components/ui/NumberInput'
import { Checkbox } from '@/components/ui/Checkbox'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Button } from '@/components/ui/Button'
import { Advanced } from '@/components/ui/Advanced'

export function HouseholdSection() {
  const { activePlan, updateActivePlan, selectedPersonId, setSelectedPersonId, now, nowYear } = usePlanStore()
  const people = activePlan.people
  const person = people.find(p => p.id === selectedPersonId) ?? people[0]

  useEffect(() => {
    if (person && person.id !== selectedPersonId) setSelectedPersonId(person.id)
  }, [person, selectedPersonId, setSelectedPersonId])

  const add = () => {
    const id = newId('person')
    updateActivePlan(plan => addPerson(plan, now, id))
    setSelectedPersonId(id)
  }

  const remove = () => {
    if (!window.confirm(`Remove ${person.name} from the plan? Their accounts and income are removed too.`)) return
    updateActivePlan(plan => deletePerson(plan, person.id, nowYear))
    setSelectedPersonId(people.find(p => p.id !== person.id)?.id ?? null)
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {people.length > 1 ? (
          <SegmentedControl
            ariaLabel="Person"
            value={person.id}
            onChange={setSelectedPersonId}
            options={people.map(p => ({ value: p.id, label: p.name || 'Unnamed' }))}
          />
        ) : (
          <p className="text-sm text-fg-muted">Planning for one person. Add a spouse or partner to plan as a couple.</p>
        )}
        <div className="flex gap-2">
          {/* Tax splitting and survivor rules are defined for one or two people. */}
          {people.length < 2 && <Button size="sm" icon={UserPlus} onClick={add}>Add person</Button>}
          {people.length > 1 && (
            <Button size="sm" variant="ghost" icon={Trash2} onClick={remove} className="hover:text-danger">
              Remove {person.name}
            </Button>
          )}
        </div>
      </div>
      <PersonCard key={person.id} person={person} />
      <BenefitsCard key={`b-${person.id}`} person={person} />
      <Advanced>
        <RoomCard person={person} />
      </Advanced>
    </>
  )
}

function usePersonUpdate(personId: string) {
  const { updateActivePlan } = usePlanStore()
  return (patch: Partial<PersonV2>) => updateActivePlan(plan => patchPerson(plan, personId, patch))
}

function PersonCard({ person }: { person: PersonV2 }) {
  const { updateActivePlan, nowYear } = usePlanStore()
  const update = usePersonUpdate(person.id)
  const currentAge = nowYear - person.birthYear
  const retirementError = validateRetirementAge(person.retirementAge, currentAge)

  return (
    <Card>
      <CardHeader title="About you" description="Ages and the province you file taxes in." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Name">
          <TextInput value={person.name} onChange={(e) => update({ name: e.target.value })} />
        </Field>
        <Field label="Province or territory" info="Where you live and file taxes. Sets provincial income tax and credits, and whether CPP or QPP applies.">
          <Select value={person.province} onChange={(e) => update({ province: e.target.value as ProvinceCode })}>
            {PROVINCES.map(code => <option key={code} value={code}>{provinceName(code)}</option>)}
          </Select>
        </Field>
        <Field label="Current age">
          <IntegerInput
            value={currentAge}
            min={16}
            max={100}
            onChange={(v) => updateActivePlan(plan => updateLegacyPersonField(plan, person.id, 'currentAge', v, nowYear))}
          />
        </Field>
        <Field label="Retirement age" error={retirementError}>
          <IntegerInput value={person.retirementAge} min={currentAge} max={100} onChange={(v) => update({ retirementAge: v })} />
        </Field>
        <Field label="Plan to age" info="How long the plan must last. Planning to 95 is a common, cautious choice.">
          <IntegerInput value={person.lifeExpectancy} min={60} max={110} onChange={(v) => update({ lifeExpectancy: v })} />
        </Field>
      </div>
    </Card>
  )
}

function BenefitsCard({ person }: { person: PersonV2 }) {
  const { activePlan } = usePlanStore()
  const { navigate } = useRoute()
  const { isAdvanced } = useDetailLevel()
  const update = usePersonUpdate(person.id)
  const pensionName = person.province === 'QC' ? 'QPP' : 'CPP'
  const salary = primarySalary(activePlan, person.id)
  const cpp = person.cpp
  const amountAt65 = cppAmountAt65(person, salary)

  const setMode = (mode: string) => {
    if (mode === cpp.mode) return
    if (mode === 'amount') return update({ cpp: { mode: 'amount', amountAt65: Math.round(amountAt65) } })
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

  return (
    <Card>
      <CardHeader
        title="Government benefits"
        description={`${pensionName} and Old Age Security. Amounts are in today's dollars.`}
        actions={
          <button
            type="button"
            onClick={() => navigate({ view: 'projections', sub: 'benefits' })}
            className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:text-accent-hover"
          >
            Compare start ages <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        }
      />

      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label={`How should we work out your ${pensionName}?`}
            info={`Your ${person.province === 'QC' ? 'Retraite Québec' : 'My Service Canada Account'} statement shows your exact estimate. Without it, a few questions about your work history give a good estimate with the ${pensionName} formula.`}
            className="sm:col-span-2"
          >
            <Select value={cpp.mode} onChange={(e) => setMode(e.target.value)}>
              <option value="history">Estimate it from my work history</option>
              <option value="amount">I have my statement amount</option>
              {(isAdvanced || cpp.mode === 'earnings') && <option value="earnings">% of maximum earnings and years</option>}
            </Select>
          </Field>

          {cpp.mode === 'amount' && (
            <Field label={`${pensionName} at 65, per year`} hint="The age-65 amount on your statement." className="sm:col-span-2 sm:max-w-xs">
              <NumberInput value={cpp.amountAt65} min={0} max={25000} onChange={(v) => update({ cpp: { mode: 'amount', amountAt65: v } })} />
            </Field>
          )}

          {cpp.mode === 'history' && (
            <>
              <Field label="Year you started working in Canada">
                <IntegerInput value={cpp.startedWorkingYear} min={1940} max={2100} onChange={(v) => update({ cpp: { ...cpp, startedWorkingYear: v } })} />
              </Field>
              <Field
                label="Typical yearly earnings"
                info={`Your usual employment income over your career, in today's dollars. ${pensionName} counts earnings up to $85,000 (2026).`}
                hint={cpp.typicalEarnings === undefined ? `Using your salary: ${money(salary)}` : undefined}
              >
                <NumberInput value={cpp.typicalEarnings ?? 0} min={0} onChange={(v) => update({ cpp: { ...cpp, typicalEarnings: v > 0 ? v : undefined } })} />
              </Field>
              <Advanced>
                <Field label="Years without earnings" info="Years after you started working and before 65 with little or no employment income: living abroad, full-time school, unemployment.">
                  <IntegerInput value={cpp.yearsNotWorking} min={0} max={47} onChange={(v) => update({ cpp: { ...cpp, yearsNotWorking: v } })} />
                </Field>
                <Field label="Years at home with a child under 7" info="These years are left out of the calculation instead of lowering your average (the child-rearing provision).">
                  <IntegerInput value={cpp.childRearingYears} min={0} max={47} onChange={(v) => update({ cpp: { ...cpp, childRearingYears: v } })} />
                </Field>
              </Advanced>
            </>
          )}

          {cpp.mode === 'earnings' && (
            <>
              <Field label="Average earnings (% of maximum)">
                <IntegerInput value={cpp.averageEarningsRatioPct} min={0} max={100} onChange={(v) => update({ cpp: { ...cpp, averageEarningsRatioPct: v } })} />
              </Field>
              <Field label="Years contributing (18–65)">
                <IntegerInput value={cpp.contributoryYears} min={0} max={47} onChange={(v) => update({ cpp: { ...cpp, contributoryYears: v } })} />
              </Field>
            </>
          )}
        </div>

        {cpp.mode !== 'amount' && (
          <div className="rounded-lg bg-surface-muted px-4 py-3">
            <div className="text-sm text-fg">
              Estimated {pensionName} at 65: <span className="font-semibold">{money(amountAt65)}/yr</span>
            </div>
            {estimate && (
              <p className="mt-1 text-xs text-fg-muted">
                {estimate.workingYears} working years until {Math.min(person.retirementAge, 65)}; your best {estimate.countedYears} count,
                at {Math.round(estimate.earningsRatio * 100)}% of maximum earnings. Your official statement is more accurate.
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 border-t border-border pt-5 sm:grid-cols-3">
          <Field label={`${pensionName} start age`} info={`60 to ${maxPensionStartAge(person.province)}. Each month before 65 lowers the pension by 0.6%; each month after raises it by 0.7%, for life.`}>
            <Select value={person.cppStartAge} onChange={(e) => update({ cppStartAge: Number(e.target.value) })}>
              {range(CPP_MIN_START_AGE, maxPensionStartAge(person.province)).map(age => {
                const amount = getCppIncomeAtAge(amountAt65, age, age, maxPensionStartAge(person.province))
                return <option key={age} value={age}>{amount > 0 ? `${age} · ${money(amount)}/yr` : age}</option>
              })}
            </Select>
          </Field>
          <Field label="OAS start age" info="65 to 70. Each month you wait past 65 raises OAS by 0.6% (7.2% a year), for life.">
            <Select value={person.oas.startAge} onChange={(e) => update({ oas: { ...person.oas, startAge: Number(e.target.value) } })}>
              {range(OAS_MIN_START_AGE, OAS_MAX_START_AGE).map(age => (
                <option key={age} value={age}>{age} · {money(getOasIncomeAtAge(OAS_MAX_ANNUAL_2026, age, age))}/yr</option>
              ))}
            </Select>
          </Field>
          <Field label="Years in Canada after 18" info="Full OAS needs 40 years of residence after 18. With fewer, you get 1/40 per year (at least 10 years to qualify).">
            <IntegerInput value={person.oas.yearsInCanadaAfter18} min={0} max={47} onChange={(v) => update({ oas: { ...person.oas, yearsInCanadaAfter18: v } })} />
          </Field>
        </div>
      </div>
    </Card>
  )
}

function RoomCard({ person }: { person: PersonV2 }) {
  const update = usePersonUpdate(person.id)
  return (
    <Card>
      <CardHeader title="Contribution room" description="Warns you when planned RRSP or TFSA contributions exceed your room." />
      <Checkbox
        checked={person.room !== undefined}
        onChange={(on) => update({ room: on ? { rrsp: 0, tfsa: 0 } : undefined })}
        label="Track RRSP and TFSA contribution room"
        description="Use the unused room on your CRA Notice of Assessment or in My Account. New room is added each year."
      />
      {person.room && (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Unused RRSP room">
            <NumberInput value={person.room.rrsp ?? 0} min={0} onChange={(v) => update({ room: { ...person.room, rrsp: v } })} />
          </Field>
          <Field label="Unused TFSA room">
            <NumberInput value={person.room.tfsa ?? 0} min={0} onChange={(v) => update({ room: { ...person.room, tfsa: v } })} />
          </Field>
        </div>
      )}
    </Card>
  )
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i)
}
