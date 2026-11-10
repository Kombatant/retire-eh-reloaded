import type { ProvinceCode } from '@/lib/plan/schema'

// RRIF minimum withdrawal factors (Income Tax Regulations s. 7308).
// Under 71: 1 / (90 − age). From 71: prescribed table; 20% from 95.
const RRIF_FACTORS_71_PLUS: Record<number, number> = {
  71: 0.0528, 72: 0.054, 73: 0.0553, 74: 0.0567, 75: 0.0582, 76: 0.0598, 77: 0.0617,
  78: 0.0636, 79: 0.0658, 80: 0.0682, 81: 0.0708, 82: 0.0738, 83: 0.0771, 84: 0.0808,
  85: 0.0851, 86: 0.0899, 87: 0.0955, 88: 0.1021, 89: 0.1099, 90: 0.1192, 91: 0.1306,
  92: 0.1449, 93: 0.1634, 94: 0.1879,
}

// `age` is the age at the start of the year (January 1).
export function rrifMinimumFactor(age: number): number {
  if (age >= 95) return 0.2
  if (age >= 71) return RRIF_FACTORS_71_PLUS[Math.floor(age)]
  return 1 / (90 - Math.max(0, age))
}

// Published 2026 LIF maximums, percent of the January 1 balance, ages 50 to 88.
// The prior-year-investment-return alternative some provinces allow is not
// used: it can only raise the maximum, so ignoring it errs cautious.
const MANITOBA_NOVA_SCOTIA = [
  6.1, 6.1, 6.1, 6.1, 6.1, 6.4, 6.5, 6.5, 6.6, 6.7, 6.7, 6.8, 6.9, 7, 7.1, 7.2, 7.3, 7.4, 7.6, 7.7,
  7.9, 8.1, 8.3, 8.5, 8.8, 9.1, 9.4, 9.8, 10.3, 10.8, 11.5, 12.1, 12.9, 13.8, 14.8, 16, 17.3, 18.9, 20,
]
const FEDERAL = [
  4.99, 5.03, 5.07, 5.11, 5.16, 5.21, 5.26, 5.32, 5.39, 5.46, 5.53, 5.61, 5.7, 5.8, 5.91, 6.03, 6.16, 6.3, 6.47, 6.65,
  6.85, 7.08, 7.34, 7.64, 7.98, 8.38, 8.84, 9.37, 9.99, 10.73, 11.61, 12.7, 14.05, 15.8, 18.13, 21.4, 26.3, 34.48, 50.86,
]
const TABLE_FIRST_AGE = 50

function fromTable(table: number[], age: number, atEnd: number): number {
  const i = Math.max(0, Math.floor(age) - TABLE_FIRST_AGE)
  return (i < table.length ? table[i] : atEnd) / 100
}

// LIF maximum for a January 1 age. Alberta, BC, Ontario, New Brunswick and
// Newfoundland share one formula: the annuity-due payment that exhausts the
// balance by 90, at 6%. Saskatchewan uses this too, as an approximation.
export function lifMaximumFactor(age: number, jurisdiction?: ProvinceCode | 'FED', rate = 0.06): number {
  if (jurisdiction === 'MB' || jurisdiction === 'NS') return fromTable(MANITOBA_NOVA_SCOTIA, age, 20)
  if (jurisdiction === 'FED') return fromTable(FEDERAL, age, 100)
  const years = 90 - Math.floor(age)
  if (years <= 1) return 1
  return rate / (1 - Math.pow(1 + rate, -years)) / (1 + rate)
}

// Locked-in accounts can usually start paying out at 55.
export const LIF_EARLIEST_AGE = 55
