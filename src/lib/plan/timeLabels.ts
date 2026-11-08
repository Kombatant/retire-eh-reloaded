import type { PersonV2, TimePoint } from './schema'

// Short, readable label for a point in time, e.g. "At retirement", "Age 75", "2030".
export function describeTimePoint(point: TimePoint | undefined, people: Pick<PersonV2, 'id' | 'name'>[], unset: string): string {
  if (!point) return unset
  const who = (personId: string) => (people.length > 1 ? `${people.find(p => p.id === personId)?.name ?? ''}'s ` : '')
  switch (point.kind) {
    case 'now':
      return 'Now'
    case 'year':
      return String(point.year)
    case 'age':
      return people.length > 1 ? `${who(point.personId)}age ${point.age}` : `Age ${point.age}`
    case 'retirement': {
      const base = people.length > 1 ? `${who(point.personId)}retirement` : 'Retirement'
      const offset = point.offset ?? 0
      if (offset === 0) return base
      return `${base} ${offset > 0 ? '+' : '−'}${Math.abs(offset)} yr`
    }
  }
}
