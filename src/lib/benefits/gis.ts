import { getTaxYear, type TaxYearData } from '@/lib/tax/data/2026'

export interface GisPerson {
  receivesOas: boolean
  // Income counted for GIS: net income excluding OAS and GIS (TFSA
  // withdrawals are not income). Employment income gets an exemption.
  otherIncome: number
  employmentIncome: number
}

// Employment exemption: the first $5,000 and half of the next $10,000.
function countable(p: GisPerson, data: TaxYearData): number {
  const g = data.gis
  const employment = Math.max(0, p.employmentIncome)
  const exempt = Math.min(employment, g.employmentExemptionFull) +
    0.5 * Math.min(Math.max(0, employment - g.employmentExemptionFull), g.employmentExemptionHalf)
  return Math.max(0, p.otherIncome + employment - exempt)
}

// Annual GIS in plan-start dollars for each person (single or couple).
//
// Simplification: the real schedule reduces the benefit by $1 per $2 of
// income (singles) or $1 per $4 of combined income (couples), plus a faster
// reduction of the top-up portion. We interpolate linearly from the maximum
// benefit at zero income to zero at the published income cutoff, which
// matches both end points of the official tables. GIS is based on the
// previous year's income; we use the current year's, assuming stable income.
export function gisAnnual(people: GisPerson[], data: TaxYearData = getTaxYear()): number[] {
  const g = data.gis
  if (people.length === 0) return []
  if (people.length === 1 || people.length > 2) {
    return people.map(p => {
      if (!p.receivesOas) return 0
      return Math.max(0, g.single.maxAnnual * (1 - countable(p, data) / g.single.incomeCutoff))
    })
  }
  const combined = countable(people[0], data) + countable(people[1], data)
  const bothOas = people[0].receivesOas && people[1].receivesOas
  return people.map(p => {
    if (!p.receivesOas) return 0
    if (bothOas) {
      return Math.max(0, g.coupleBothOas.maxAnnualEach * (1 - combined / g.coupleBothOas.combinedCutoff))
    }
    return Math.max(0, g.coupleSpouseNoOas.maxAnnual * (1 - combined / g.coupleSpouseNoOas.combinedCutoff))
  })
}
