import { getTaxYear, type TaxYearData } from '@/lib/tax/data/2026'

export interface GisPerson {
  receivesOas: boolean
  // Income counted for GIS: net income excluding OAS and GIS (TFSA
  // withdrawals are not income). Employment income gets an exemption.
  otherIncome: number
  employmentIncome: number
  // For the Allowances, which depend on age, residence and having been widowed.
  age?: number
  residencyYears?: number
  widowed?: boolean
}

// Employment exemption: the first $5,000 and half of the next $10,000.
function countable(p: GisPerson, data: TaxYearData): number {
  const g = data.gis
  const employment = Math.max(0, p.employmentIncome)
  const exempt = Math.min(employment, g.employmentExemptionFull) +
    0.5 * Math.min(Math.max(0, employment - g.employmentExemptionFull), g.employmentExemptionHalf)
  return Math.max(0, p.otherIncome + employment - exempt)
}

function annualFrom(table: [number, number][], income: number): number {
  if (income >= table[table.length - 1][0]) return 0
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i]
    if (income > x1) continue
    const [x0, y0] = table[i - 1]
    return Math.max(0, y0 + ((y1 - y0) * (income - x0)) / (x1 - x0)) * 12
  }
  return 0
}

// Three dollars a month: how closely the break points follow the tables.
const TABLE_ROUNDING = 36

function eligibleForAllowance(p: GisPerson, data: TaxYearData): boolean {
  const g = data.gis
  return p.age !== undefined && p.age >= g.allowanceMinAge && p.age <= g.allowanceMaxAge && (p.residencyYears ?? 0) >= g.allowanceMinResidencyYears
}

// Annual GIS or Allowance in plan-start dollars for each person (single or
// couple), from the published tables. Partial OAS isn't reflected: the tables
// are for a full pension, so a partial pensioner's GIS is on the low side.
//
// A younger spouse's age alone doesn't change the couple's status. Where the
// Allowance applies the couple takes the better of the two published tables,
// so it never lowers what the household would get without it.
export function gisAnnual(people: GisPerson[], data: TaxYearData = getTaxYear()): number[] {
  const g = data.gis
  if (people.length === 0) return []
  if (people.length !== 2) {
    return people.map(p => {
      if (p.receivesOas) return annualFrom(g.single, countable(p, data))
      return p.widowed && eligibleForAllowance(p, data) ? annualFrom(g.survivorAllowance, countable(p, data)) : 0
    })
  }
  const combined = countable(people[0], data) + countable(people[1], data)
  if (people[0].receivesOas && people[1].receivesOas) return people.map(() => annualFrom(g.coupleBothOas, combined))
  if (!people[0].receivesOas && !people[1].receivesOas) return [0, 0]

  const pensioner = people[0].receivesOas ? 0 : 1
  const alone = annualFrom(g.coupleSpouseNoOas, combined)
  const result = [0, 0]
  result[pensioner] = alone
  if (eligibleForAllowance(people[1 - pensioner], data)) {
    const gis = annualFrom(g.couplePensionerWithAllowance, combined)
    const allowance = annualFrom(g.coupleAllowance, combined)
    // Near the top of the range the two tables pay a couple the same; the
    // tolerance keeps the break points' rounding from choosing between them.
    if (gis + allowance >= alone - TABLE_ROUNDING) {
      result[pensioner] = gis
      result[1 - pensioner] = allowance
    }
  }
  return result
}
