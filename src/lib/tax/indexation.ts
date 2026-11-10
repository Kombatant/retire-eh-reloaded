import type { ProvinceTaxData } from './data/2026'

// What a province's 2026 amounts are worth, in plan-start dollars, in a later
// year. The tax engine multiplies 2026 thresholds and credits by these. A fully
// indexed amount keeps a value of 1. An amount frozen in law erodes as 1 / CPI.
export interface RealValues {
  brackets: number
  credits: number
  basicPersonal: number
  pension: number
}

const isPaused = (prov: ProvinceTaxData, year: number) => prov.indexPauses?.some(p => year >= p.from && year <= p.to) ?? false

// One entry per simulated year, for one market path. Steps dated before the
// first year are already in the 2026 figure, or apply from the start.
export function provinceRealValues(prov: ProvinceTaxData, startYear: number, cpi: Float64Array, inflation: Float64Array): RealValues[] {
  const out: RealValues[] = []
  let bracketIndex = 1
  let creditIndex = 1
  let basicPersonal = prov.basicPersonal
  for (let t = 0; t < cpi.length; t++) {
    const year = startYear + t
    if (t > 0 && !isPaused(prov, year)) {
      const grow = 1 + (inflation[t - 1] ?? 0)
      if (prov.bracketsIndexed) bracketIndex *= grow
      if (prov.creditsIndexed) {
        creditIndex *= grow
        basicPersonal *= grow
      }
    }
    for (const step of prov.basicPersonalSteps ?? []) {
      const applies = t === 0 ? step.year <= year : step.year === year
      if (applies) basicPersonal = step.setTo ?? basicPersonal + (step.add ?? 0)
    }
    const k = cpi[t]
    out.push({
      brackets: bracketIndex / k,
      credits: creditIndex / k,
      basicPersonal: basicPersonal / (prov.basicPersonal * k),
      pension: prov.pensionIndexed ? creditIndex / k : 1 / k,
    })
  }
  return out
}
