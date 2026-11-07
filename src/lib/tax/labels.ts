import type { ProvinceCode } from '@/lib/plan/schema'
import { TAX_2026 } from './data/2026'

export function provinceName(code: ProvinceCode): string {
  return TAX_2026.provinces[code].name
}

// "Ontario", or "Ontario and Quebec" for a household that spans provinces.
export function jurisdictionLabel(codes: readonly ProvinceCode[]): string {
  const names = [...new Set(codes)].map(provinceName)
  if (names.length <= 1) return names[0] ?? 'provincial'
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
