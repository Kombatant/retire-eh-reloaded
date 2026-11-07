import { oasAdjustmentFactor, clampOasStartAge } from '@/lib/calculations'
import { getTaxYear, type TaxYearData } from '@/lib/tax/data/2026'

// Annual OAS pension in plan-start dollars for a person of `age`.
// - Partial pension: 1/40 per year lived in Canada after 18 (minimum 10 years).
// - Deferral: +0.6% per month after 65, up to 70.
// - The pension is permanently 10% higher from age 75.
// The recovery tax (clawback) is applied by the income tax engine.
export function oasAnnualAmount(
  params: { age: number; startAge: number; yearsInCanadaAfter18: number },
  data: TaxYearData = getTaxYear(),
): number {
  const { age, yearsInCanadaAfter18 } = params
  const startAge = clampOasStartAge(params.startAge)
  if (age < startAge) return 0
  const o = data.oas
  if (yearsInCanadaAfter18 < o.minResidencyYears) return 0
  const residency = Math.min(1, yearsInCanadaAfter18 / o.fullResidencyYears)
  const age75 = age >= 75 ? 1 + o.age75Increase : 1
  return o.maxAt65 * residency * oasAdjustmentFactor(startAge) * age75
}
