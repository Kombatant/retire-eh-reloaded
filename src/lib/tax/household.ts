import { computeIncomeTax, eligiblePensionIncome, type IncomeTaxInput, type IncomeTaxResult, type TaxOptions } from './personal'

export interface HouseholdTaxResult {
  perPerson: IncomeTaxResult[]
  // Signed split applied to each person (+ received, − transferred).
  splits: number[]
  total: number
}

type Member = Omit<IncomeTaxInput, 'pensionSplit'>

// Up to 50% of eligible pension income can be transferred to a spouse.
// Quebec only allows it when the transferor is 65 or older, which we apply to
// both federal and Quebec returns to keep one split amount.
export function splittableAmount(member: Member): number {
  if (member.province === 'QC' && member.age < 65) return 0
  return 0.5 * eligiblePensionIncome(member)
}

function evaluate(members: Member[], splits: number[], opts: TaxOptions): HouseholdTaxResult {
  const perPerson = members.map((m, i) => computeIncomeTax({ ...m, pensionSplit: splits[i] }, opts))
  return { perPerson, splits, total: perPerson.reduce((s, r) => s + r.total, 0) }
}

// Household income tax with optional pension income splitting between two
// spouses. Tax is piecewise linear in the split amount but not convex (credit
// phase-outs and the OAS clawback), so we grid-search and then refine around
// the best point instead of assuming a single optimum.
export function computeHouseholdTax(
  members: Member[],
  opts: TaxOptions & { splitting?: boolean } = {},
): HouseholdTaxResult {
  const noSplit = members.map(() => 0)
  let best = evaluate(members, noSplit, opts)
  if (!opts.splitting || members.length !== 2) return best

  for (const from of [0, 1]) {
    const to = 1 - from
    const max = splittableAmount(members[from])
    if (max <= 0) continue
    const tryAmount = (amount: number) => {
      const splits = [0, 0]
      splits[from] = -amount
      splits[to] = amount
      const result = evaluate(members, splits, opts)
      if (result.total < best.total - 0.005) best = result
    }
    const coarse = 16
    let bestAmount = 0
    let bestTotal = Infinity
    for (let k = 0; k <= coarse; k++) {
      const amount = (max * k) / coarse
      const total = evaluate(members, from === 0 ? [-amount, amount] : [amount, -amount], opts).total
      if (total < bestTotal) {
        bestTotal = total
        bestAmount = amount
      }
    }
    const step = max / coarse
    for (let k = -8; k <= 8; k++) {
      tryAmount(Math.min(max, Math.max(0, bestAmount + (step * k) / 8)))
    }
  }
  return best
}
