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
