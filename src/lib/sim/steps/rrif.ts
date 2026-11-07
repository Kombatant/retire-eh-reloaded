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

// LIF maximum, approximated with the common provincial formula: the payment
// that would exhaust the balance by the end of the year the holder turns 90,
// at a 6% reference rate (provinces use the greater of 6% and the long-term
// bond rate). At 90 and over the whole balance may be withdrawn.
export function lifMaximumFactor(age: number, rate = 0.06): number {
  const years = 90 - Math.floor(age) + 1
  if (years <= 1) return 1
  return rate / (1 - Math.pow(1 + rate, -years))
}

// Locked-in accounts can usually start paying out at 55.
export const LIF_EARLIEST_AGE = 55
