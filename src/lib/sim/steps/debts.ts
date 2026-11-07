// One year of monthly amortization. Payments stop once the debt is repaid.
export function amortizeYear(balance: number, annualRate: number, monthlyPayment: number): { balance: number; paid: number; interest: number } {
  let remaining = Math.max(0, balance)
  let paid = 0
  let interest = 0
  const monthlyRate = annualRate / 12
  for (let m = 0; m < 12 && remaining > 0; m++) {
    const accrued = remaining * monthlyRate
    const payment = Math.min(monthlyPayment, remaining + accrued)
    remaining = remaining + accrued - payment
    paid += payment
    interest += accrued
  }
  // A payment below the interest grows the balance; it never goes negative.
  return { balance: Math.max(0, remaining), paid, interest }
}

// Months to repay at a fixed payment (Infinity if the payment never covers interest).
export function monthsToRepay(balance: number, annualRate: number, monthlyPayment: number): number {
  const r = annualRate / 12
  if (balance <= 0) return 0
  if (r === 0) return Math.ceil(balance / monthlyPayment)
  if (monthlyPayment <= balance * r) return Infinity
  return Math.ceil(-Math.log(1 - (balance * r) / monthlyPayment) / Math.log(1 + r))
}
