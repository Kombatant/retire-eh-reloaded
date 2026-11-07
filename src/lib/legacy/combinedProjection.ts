import { projectPersonAccounts } from './engine'
import type { Account } from '@/types/person'
import type { ProjectionDataPoint } from '@/types/projection'

// Original (v1) household accumulation projection, kept for parity tests.
// Each person accumulates to their own retirement age. After that their
// portfolio keeps compounding (no more contributions; pre-retirement drawdown
// is out of scope here). We project every person on their own timeline and sum
// the result by age so contributions stop per person, not at a single
// household age.
export function buildCombinedProjection(
  people: { currentAge: number; retirementAge: number; accounts: Account[] }[],
  expectedReturn: number,
  inflationRate: number,
  showRealValues: boolean,
  householdRetirementAge: number,
  workingMarginalTaxRate: number,
  reinvestRrspRefund: boolean,
): ProjectionDataPoint[] {
  if (people.length === 0) return []

  const baseAge = Math.min(...people.map(p => p.currentAge))
  const endAge = householdRetirementAge
  const currentYear = new Date().getFullYear()

  const perPerson = people.map(p => {
    const rrspContribution = p.accounts
      .filter(account => account.type === 'RRSP')
      .reduce((sum, account) => sum + (account.annualContribution || 0), 0)
    const rrspRefundAnnual = reinvestRrspRefund
      ? rrspContribution * (workingMarginalTaxRate / 100)
      : 0

    return projectPersonAccounts(
      p.accounts,
      p.retirementAge,
      p.currentAge,
      expectedReturn,
      inflationRate,
      showRealValues,
      p.retirementAge - p.currentAge,
      currentYear,
      { rrspRefundAnnual }
    )
  })

  const combined: ProjectionDataPoint[] = []
  // Match the engine's monthly compounding. Real values are deflated annually,
  // so the real growth factor is nominal monthly growth divided by annual inflation.
  const monthlyGrowth = 1 + expectedReturn / 100 / 12

  // Align people by years from today, not by age. Household members are
  // different ages, so age 65 for one person is a different calendar year than
  // age 65 for another.
  for (let offset = 0; offset <= endAge - baseAge; offset++) {
    const age = baseAge + offset
    let total = 0
    let rrsp = 0
    let tfsa = 0
    let hasRrsp = false
    let hasTfsa = false

    people.forEach((_, i) => {
      const proj = perPerson[i]
      if (proj.length === 0) return
      const lastIndex = proj.length - 1
      const point = proj[Math.min(offset, lastIndex)]

      // The per-person projection stops at that person's retirement age. If
      // the household retires later, keep compounding the early retiree's
      // balance at the expected return instead of freezing it. Real-dollar
      // mode compounds at the real return; nominal mode at the nominal return.
      const yearsAfterRetirement = Math.max(0, offset - lastIndex)
      const nominalFactor = Math.pow(monthlyGrowth, yearsAfterRetirement * 12)
      const growthFactor = showRealValues
        ? nominalFactor / Math.pow(1 + inflationRate / 100, yearsAfterRetirement)
        : nominalFactor
      const pointTotal = (point.Total ?? 0) * growthFactor
      const pointRrsp = point.RRSP !== undefined ? point.RRSP * growthFactor : undefined
      const pointTfsa = point.TFSA !== undefined ? point.TFSA * growthFactor : undefined

      total += pointTotal
      if (pointRrsp !== undefined) { rrsp += pointRrsp; hasRrsp = true }
      if (pointTfsa !== undefined) { tfsa += pointTfsa; hasTfsa = true }
    })

    combined.push({
      year: currentYear + offset,
      age,
      RRSP: hasRrsp ? rrsp : undefined,
      TFSA: hasTfsa ? tfsa : undefined,
      Total: total
    })
  }
  return combined
}

