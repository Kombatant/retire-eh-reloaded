import { controlBase, controlSize } from '@/lib/ui/styles'
import { Select } from './inputs'
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

const fieldClass = `${controlBase} ${controlSize.md}`

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

  const number = (raw: string, fallback: number) => {
    const parsed = parseInt(raw, 10)
    return Number.isFinite(parsed) ? parsed : fallback
  }

  return (
    <div className="flex gap-2">
      <Select
        value={kind}
        onChange={(e) => changeKind(e.target.value as Kind)}
        className="flex-1"
        aria-label={ariaLabel}
      >
        {unsetLabel && <option value="unset">{unsetLabel}</option>}
        <option value="now">Now</option>
        <option value="retirement">At retirement</option>
        <option value="age">At age</option>
        <option value="year">In year</option>
      </Select>
      {value?.kind === 'retirement' && (
        <input
          type="number"
          value={value.offset ?? 0}
          onChange={(e) => onChange({ ...value, offset: number(e.target.value, 0) })}
          className={`${fieldClass} w-20 shrink-0`}
          aria-label="Years after retirement"
          title="Years after (+) or before (−) retirement"
        />
      )}
      {value?.kind === 'age' && (
        <input
          type="number"
          value={value.age}
          min={0}
          max={120}
          onChange={(e) => onChange({ ...value, age: number(e.target.value, value.age) })}
          className={`${fieldClass} w-20 shrink-0`}
          aria-label="Age"
        />
      )}
      {value?.kind === 'year' && (
        <input
          type="number"
          value={value.year}
          min={1900}
          max={2200}
          onChange={(e) => onChange({ ...value, year: number(e.target.value, value.year) })}
          className={`${fieldClass} w-24 shrink-0`}
          aria-label="Year"
        />
      )}
    </div>
  )
}
