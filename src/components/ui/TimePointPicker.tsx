import { Select } from './inputs'
import { IntegerInput } from './IntegerInput'
import { FieldIdContext } from './fieldContext'
import type { TimePoint } from '@/lib/plan/schema'

interface TimePointPickerProps {
  value: TimePoint | undefined
  onChange: (value: TimePoint | undefined) => void
  // Person whose age / retirement the point follows.
  personId: string
  // Label for "not set" (e.g. "Plan start", "End of plan"); omit to require a value.
  unsetLabel?: string
  currentYear: number
  ariaLabel?: string
}

type Kind = 'unset' | TimePoint['kind']

export function TimePointPicker({ value, onChange, personId, unsetLabel, currentYear, ariaLabel }: TimePointPickerProps) {
  const kind: Kind = value?.kind ?? 'unset'

  const changeKind = (next: Kind) => {
    switch (next) {
      case 'unset': return onChange(undefined)
      case 'now': return onChange({ kind: 'now' })
      case 'retirement': return onChange({ kind: 'retirement', personId, offset: 0 })
      case 'age': return onChange({ kind: 'age', personId, age: 65 })
      case 'year': return onChange({ kind: 'year', year: currentYear + 5 })
    }
  }

  // The number box has a fixed width on its own wrapper: the shared control
  // style is `w-full`, which would override a width set on the input itself.
  // In narrow cells the box wraps under the select instead of squeezing it.
  return (
    <div className="flex flex-wrap gap-2">
      <Select
        value={kind}
        onChange={(e) => changeKind(e.target.value as Kind)}
        className="min-w-[8.5rem] flex-1"
        aria-label={ariaLabel}
      >
        {unsetLabel && <option value="unset">{unsetLabel}</option>}
        <option value="now">Now</option>
        <option value="retirement">At retirement</option>
        <option value="age">At age</option>
        <option value="year">In year</option>
      </Select>
      {/* A surrounding Field's label names the select; the number box has its own. */}
      <FieldIdContext.Provider value={undefined}>
        {value?.kind === 'retirement' && (
          <div className="w-20 shrink-0" title="Years after (+) or before (−) retirement">
            <IntegerInput value={value.offset ?? 0} min={-60} max={60} onChange={(offset) => onChange({ ...value, offset })} ariaLabel="Years after retirement" />
          </div>
        )}
        {value?.kind === 'age' && (
          <div className="w-20 shrink-0">
            <IntegerInput value={value.age} min={0} max={120} onChange={(age) => onChange({ ...value, age })} ariaLabel="Age" />
          </div>
        )}
        {value?.kind === 'year' && (
          <div className="w-24 shrink-0">
            <IntegerInput value={value.year} min={1900} max={2200} onChange={(year) => onChange({ ...value, year })} ariaLabel="Year" />
          </div>
        )}
      </FieldIdContext.Provider>
    </div>
  )
}
