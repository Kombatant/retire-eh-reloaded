import type { TaxBracket } from './data/2026'

export type { TaxBracket }

// Thresholds can be scaled (e.g. real-dollar value of a frozen nominal bracket).
export function progressiveTax(income: number, brackets: TaxBracket[], thresholdScale = 1): number {
  if (income <= 0) return 0
  let tax = 0
  let lower = 0
  for (const bracket of brackets) {
    const upper = bracket.upTo * thresholdScale
    if (income <= lower) break
    const taxable = Math.min(income, upper) - lower
    if (taxable > 0) tax += taxable * (bracket.rate / 100)
    lower = upper
  }
  return tax
}

export function marginalRate(income: number, brackets: TaxBracket[], thresholdScale = 1): number {
  for (const bracket of brackets) {
    if (income < bracket.upTo * thresholdScale) return bracket.rate
  }
  return brackets[brackets.length - 1]?.rate ?? 0
}

// Linear phase-out from `full` to `reduced` between two income thresholds.
export function phaseOut(income: number, full: number, reduced: number, start: number, end: number): number {
  if (income <= start) return full
  if (income >= end) return reduced
  return full - ((income - start) / (end - start)) * (full - reduced)
}
