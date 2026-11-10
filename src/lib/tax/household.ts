import { getTaxYear } from './data/2026'
import { computeIncomeTax, creditScale, eligiblePensionIncome, familyLowIncomeReduction, netIncomeOf, quebecAmountsAfterReduction, quebecOwnAmounts, type IncomeTaxInput, type IncomeTaxResult, type TaxOptions } from './personal'

export interface HouseholdTaxResult {
  perPerson: IncomeTaxResult[]
  // Signed split applied to each person (+ received, − transferred).
  splits: number[]
  // The same on the Quebec return, which has its own rules.
  quebecSplits: number[]
  total: number
}

type Member = Omit<IncomeTaxInput, 'pensionSplit'>

// Up to 50% of eligible pension income can be transferred to a spouse.
export function splittableAmount(member: Member): number {
  return 0.5 * eligiblePensionIncome(member)
}

// Schedule Q: the person transferring must be 65 or older, even for income
// from a pension plan that can be split federally at any age.
export function quebecSplittableAmount(member: Member): number {
  return member.age >= 65 ? splittableAmount(member) : 0
}

// Of a split a person receives, what counts for their own pension credit. A
// receiver under 65 can only count income from a pension plan, not a RRIF.
function creditableSplit(from: Member, to: Member, amount: number): number {
  if (to.age >= 65) return amount
  const pool = eligiblePensionIncome(from)
  return pool > 0 ? amount * (Math.max(0, from.pension) / pool) : 0
}

function evaluate(members: Member[], splits: number[], quebecSplits: number[], opts: TaxOptions): HouseholdTaxResult {
  // The spouse amount goes to whichever spouse has more income.
  let claimant = -1
  let spouseNet = 0
  if (members.length === 2) {
    const nets = members.map((m, i) => netIncomeOf({ ...m, pensionSplit: splits[i] }, opts.data).netIncome)
    claimant = nets[0] >= nets[1] ? 0 : 1
    spouseNet = nets[1 - claimant]
  }
  const sharedQuebecAmounts = members.length === 2 && members.some(m => m.province === 'QC')
  const inputs = members.map((m, i) => {
    const other = members[1 - i]
    return {
      ...m,
      pensionSplit: splits[i],
      quebecPensionSplit: quebecSplits[i],
      pensionSplitCreditable: splits[i] > 0 && other ? creditableSplit(other, m, splits[i]) : undefined,
      spouseNetIncome: i === claimant ? spouseNet : undefined,
      quebecLine361: sharedQuebecAmounts ? 0 : undefined,
      familyLowIncomeHandled: members.length === 2,
    }
  })
  const perPerson = inputs.map(input => computeIncomeTax(input, opts))
  // Schedule 2: age and pension amounts one spouse can't use reduce the other's
  // tax. Provincially, only between spouses on the same province's return;
  // Quebec moves unused credits its own way (line 431).
  if (members.length === 2) {
    const received = [0, 1].map(i => {
      const from = perPerson[1 - i]
      const sameProvince = members[0].province === members[1].province && members[0].province !== 'QC'
      return { federal: from.federalTransferable, provincial: sameProvince ? from.provincialTransferable : 0 }
    })
    received.forEach((r, i) => {
      if (r.federal > 0 || r.provincial > 0) {
        perPerson[i] = computeIncomeTax({ ...inputs[i], transferredFederalCredits: r.federal, transferredProvincialCredits: r.provincial }, opts)
      }
    })
    claimFamilyLowIncomeReduction(members, perPerson, opts)
  }
  if (sharedQuebecAmounts) shareQuebecAmounts(members, splits, quebecSplits, perPerson, opts)
  return { perPerson, splits, quebecSplits, total: perPerson.reduce((s, r) => s + r.total, 0) }
}

// One reduction per family, on combined income. Whatever one spouse can't use
// the other can claim.
function claimFamilyLowIncomeReduction(members: Member[], perPerson: IncomeTaxResult[], opts: TaxOptions) {
  const data = opts.data ?? getTaxYear()
  const claimants = members.flatMap((m, i) => (data.provinces[m.province].lowIncomeReduction ? [i] : []))
  if (claimants.length === 0) return
  const province = members[claimants[0]].province
  const familyIncome = perPerson.reduce((s, r) => s + r.netIncome - r.oasClawback, 0)
  let remaining = familyLowIncomeReduction(data.provinces[province], familyIncome, members.map(m => m.age), creditScale(province, data, opts))
  for (const i of claimants) {
    const used = Math.min(remaining, perPerson[i].provincial)
    perPerson[i].provincial -= used
    perPerson[i].total -= used
    remaining -= used
  }
}

// Schedule B: a couple works out one amount, reduced on their combined income,
// and either spouse can claim any of it. It is non-refundable, so whatever one
// spouse has no tax to absorb goes to the other. Line 431 does the same for the
// rest of a spouse's unused credits, between two Quebec returns.
function shareQuebecAmounts(members: Member[], splits: number[], quebecSplits: number[], perPerson: IncomeTaxResult[], opts: TaxOptions) {
  const data = opts.data ?? getTaxYear()
  const familyIncome = perPerson.reduce((s, r, i) => s + r.netIncome - splits[i] + quebecSplits[i] - r.oasClawback, 0)
  const amounts = members.reduce((s, m, i) => s + quebecOwnAmounts(m, quebecSplits[i], data), 0)
  let remaining = quebecAmountsAfterReduction(amounts, familyIncome, data)
  const rate = data.provinces.QC.creditRatePct / 100
  members.forEach((m, i) => {
    if (m.province !== 'QC' || remaining <= 0) return
    const res = perPerson[i]
    const used = Math.min(remaining, Math.max(0, res.provincial - res.healthPremium) / rate)
    res.provincial -= used * rate
    res.total -= used * rate
    remaining -= used
  })
  if (!members.every(m => m.province === 'QC')) return
  perPerson.forEach((res, i) => {
    const other = perPerson[1 - i]
    const moved = Math.min(res.quebecUnusedCredits, Math.max(0, other.provincial - other.healthPremium))
    other.provincial -= moved
    other.total -= moved
  })
}

// The split that scores lowest, in either direction between two spouses. Tax
// is piecewise linear in the split amount but not convex (credit phase-outs and
// the OAS clawback), so this grid-searches and then refines around the best
// point instead of assuming a single optimum.
function searchSplit(
  members: Member[],
  maxFor: (m: Member) => number,
  evaluateAt: (splits: number[]) => HouseholdTaxResult,
  score: (r: HouseholdTaxResult) => number,
): HouseholdTaxResult {
  let best = evaluateAt([0, 0])
  let bestScore = score(best)
  for (const from of [0, 1]) {
    const max = maxFor(members[from])
    if (max <= 0) continue
    const at = (amount: number) => evaluateAt(from === 0 ? [-amount, amount] : [amount, -amount])
    const coarse = 16
    let bestAmount = 0
    let bestCoarse = Infinity
    for (let k = 0; k <= coarse; k++) {
      const amount = (max * k) / coarse
      const value = score(at(amount))
      if (value < bestCoarse) {
        bestCoarse = value
        bestAmount = amount
      }
    }
    const step = max / coarse
    for (let k = -8; k <= 8; k++) {
      const result = at(Math.min(max, Math.max(0, bestAmount + (step * k) / 8)))
      const value = score(result)
      if (value < bestScore - 0.005) {
        best = result
        bestScore = value
      }
    }
  }
  return best
}

// A Quebec split follows the federal one where Schedule Q allows it.
function matchingQuebecSplits(members: Member[], splits: number[]): number[] {
  const transferor = splits.findIndex(s => s < 0)
  return transferor >= 0 && members[transferor].age >= 65 ? splits : members.map(() => 0)
}

// Household income tax with optional pension income splitting between two
// spouses. The spouses choose their federal and Quebec splits separately, and
// the two returns don't affect each other, so each is searched on its own tax.
export function computeHouseholdTax(
  members: Member[],
  opts: TaxOptions & { splitting?: boolean } = {},
): HouseholdTaxResult {
  const noSplit = members.map(() => 0)
  if (!opts.splitting || members.length !== 2) return evaluate(members, noSplit, noSplit, opts)

  if (!members.every(m => m.province === 'QC')) {
    return searchSplit(members, splittableAmount, splits => evaluate(members, splits, matchingQuebecSplits(members, splits), opts), r => r.total)
  }
  const federal = searchSplit(members, splittableAmount, splits => evaluate(members, splits, noSplit, opts),
    r => r.perPerson.reduce((s, p) => s + p.federal + p.oasClawback, 0))
  return searchSplit(members, quebecSplittableAmount, quebecSplits => evaluate(members, federal.splits, quebecSplits, opts),
    r => r.perPerson.reduce((s, p) => s + p.provincial, 0))
}
