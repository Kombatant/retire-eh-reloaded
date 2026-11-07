export function newId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}
