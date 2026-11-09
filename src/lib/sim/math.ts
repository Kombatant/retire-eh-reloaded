/**
 * Compound future value with monthly compounding and end-of-month contributions.
 */
export function calculateFutureValue(
  presentValue: number,
  monthlyContribution: number,
  monthlyReturnRate: number,
  months: number
): number {
  if (Math.abs(monthlyReturnRate) < Number.EPSILON) {
    return presentValue + monthlyContribution * months
  }
  const factor = Math.pow(1 + monthlyReturnRate, months)
  const fvOfPv = presentValue * factor
  const fvOfContributions = monthlyContribution * ((factor - 1) / monthlyReturnRate)
  return fvOfPv + fvOfContributions
}

export function sum(values: ArrayLike<number>): number {
  let total = 0
  for (let i = 0; i < values.length; i++) total += values[i]
  return total
}

// Linear interpolation between the two nearest values of an ascending array.
export function quantile(sorted: ArrayLike<number>, q: number): number {
  if (sorted.length === 0) return 0
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}
