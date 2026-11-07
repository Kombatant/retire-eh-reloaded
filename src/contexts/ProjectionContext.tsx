import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { usePeople } from './PeopleContext'
import { useAssumptions } from './AssumptionsContext'
import { usePlanStore } from './PlanStoreContext'
import {
  compilePlan,
  deterministicPath,
  simulate,
  toCashFlowRows,
  toProjectionData,
  householdBaseAge,
  type CashFlowRow,
  type CompiledPlan,
  type SimResult,
} from '@/lib/sim'
import { buildGuaranteedIncomeSchedule, getCppIncomeAtAge, getGiftTotal, getOasIncomeAtAge } from '@/lib/calculations'
import { computeRetirementTaxSummary, OAS_MAX_ANNUAL_2026, type RetirementTaxSummary } from '@/lib/tax'
import type { ProjectionDataPoint } from '@/types/projection'

interface ProjectionContextValueTyped {
  // Unified engine output for the active plan at its expected return.
  compiledPlan: CompiledPlan
  simulation: SimResult
  retirementCashFlow: CashFlowRow[]
  projectionData: ProjectionDataPoint[]
  conservativeProjectionData: ProjectionDataPoint[]
  optimisticProjectionData: ProjectionDataPoint[]
  realProjectionData: ProjectionDataPoint[]
  currentProjectionData: ProjectionDataPoint[]
  householdRetirementAge: number
  yearsToRetirement: number
  minCurrentAge: number
  totalAnnualIncome: number
  totalAnnualPension: number
  totalAnnualCpp: number
  totalAnnualOas: number
  guaranteedIncomeSchedule: number[]
  totalPortfolio: number
  totalAnnualContributions: number
  retirementTax: RetirementTaxSummary | null
}

const ProjectionContext = createContext<ProjectionContextValueTyped | null>(null)

function scaleRetirementTaxSummary(
  summary: RetirementTaxSummary,
  factor: number,
): RetirementTaxSummary {
  if (factor === 1) return summary
  return {
    ...summary,
    perPerson: summary.perPerson.map(p => ({
      ...p,
      pension: p.pension * factor,
      cpp: p.cpp * factor,
      oas: p.oas * factor,
      rrifWithdrawal: p.rrifWithdrawal * factor,
      taxableIncome: p.taxableIncome * factor,
      federal: p.federal * factor,
      quebec: p.quebec * factor,
      oasClawback: p.oasClawback * factor,
      total: p.total * factor,
    })),
    guaranteedIncome: summary.guaranteedIncome * factor,
    portfolioWithdrawal: summary.portfolioWithdrawal * factor,
    taxableWithdrawal: summary.taxableWithdrawal * factor,
    taxFreeWithdrawal: summary.taxFreeWithdrawal * factor,
    rrspTax: summary.rrspTax * factor,
    totalTax: summary.totalTax * factor,
    oasClawback: summary.oasClawback * factor,
    preTaxIncome: summary.preTaxIncome * factor,
    afterTaxIncome: summary.afterTaxIncome * factor,
  }
}

export function ProjectionProvider({ children }: { children: ReactNode }) {
  const { people } = usePeople()
  const {
    expectedReturn,
    inflationRate,
    showRealValues,
    withdrawalRate,
    plannedGifts,
  } = useAssumptions()

  const { activePlan, nowYear } = usePlanStore()

  const compiledPlan = useMemo(() => compilePlan(activePlan, { startYear: nowYear }), [activePlan, nowYear])
  const runAt = useMemo(() => (returnPct: number) => simulate(
    compiledPlan,
    deterministicPath(compiledPlan.years, returnPct, compiledPlan.inflationPct),
  ), [compiledPlan])
  const simulation = useMemo(() => runAt(expectedReturn), [runAt, expectedReturn])
  const conservativeSimulation = useMemo(() => runAt(Math.max(0, expectedReturn - 2)), [runAt, expectedReturn])
  const optimisticSimulation = useMemo(() => runAt(expectedReturn + 2), [runAt, expectedReturn])

  // The household starts drawing down when its last member retires. Ages on
  // this axis are the youngest person's, as in the original app.
  const minCurrentAge = people.length ? householdBaseAge(compiledPlan) : 0
  const yearsToRetirement = people.length ? compiledPlan.drawdownStartOffset : 0
  const householdRetirementAge = minCurrentAge + yearsToRetirement
  const totalAnnualIncome = people.reduce((sum, p) => sum + (p.annualIncome || 0), 0)
  const totalAnnualPension = people.reduce((sum, p) => sum + (p.annualPension || 0), 0)
  const totalAnnualCpp = people.reduce((sum, p) => {
    const ageAtHouseholdRetirement = p.currentAge + yearsToRetirement
    return sum + getCppIncomeAtAge(p.annualCpp, p.cppStartAge, ageAtHouseholdRetirement)
  }, 0)
  const totalAnnualOas = people.reduce((sum, p) => {
    const ageAtRetirement = p.currentAge + yearsToRetirement
    return sum + getOasIncomeAtAge(OAS_MAX_ANNUAL_2026, p.oasStartAge, ageAtRetirement)
  }, 0)
  const allAccounts = people.flatMap(p => p.accounts)
  const totalPortfolio = allAccounts.reduce((sum, acc) => sum + (acc.balance || 0), 0)
  const totalAnnualContributions = allAccounts.reduce((sum, acc) => sum + (acc.annualContribution || 0), 0)

  const guaranteedIncomeSchedule = useMemo(
    () => buildGuaranteedIncomeSchedule({ people, householdRetirementAge, yearsToRetirement }),
    [people, householdRetirementAge, yearsToRetirement]
  )

  const projectionData = useMemo(
    () => toProjectionData(compiledPlan, simulation, showRealValues),
    [compiledPlan, simulation, showRealValues]
  )
  const conservativeProjectionData = useMemo(
    () => toProjectionData(compiledPlan, conservativeSimulation, showRealValues),
    [compiledPlan, conservativeSimulation, showRealValues]
  )
  const optimisticProjectionData = useMemo(
    () => toProjectionData(compiledPlan, optimisticSimulation, showRealValues),
    [compiledPlan, optimisticSimulation, showRealValues]
  )
  const realProjectionData = useMemo(
    () => toProjectionData(compiledPlan, simulation, true),
    [compiledPlan, simulation]
  )
  const retirementCashFlow = useMemo(
    () => toCashFlowRows(compiledPlan, simulation, showRealValues),
    [compiledPlan, simulation, showRealValues]
  )

  const retirementTax = useMemo(() => {
    if (people.length === 0 || realProjectionData.length === 0) return null

    const incomePeople = people.map(p => {
      const ageAtRetirement = p.currentAge + yearsToRetirement
      return {
        name: p.name,
        ageAtRetirement,
        pension: p.annualPension || 0,
        cpp: getCppIncomeAtAge(p.annualCpp, p.cppStartAge, ageAtRetirement),
        oas: getOasIncomeAtAge(OAS_MAX_ANNUAL_2026, p.oasStartAge, ageAtRetirement),
      }
    })

    // Brackets and credits are fixed to 2026, so tax must be computed in
    // today's dollars. Converting the dollar results afterwards keeps the
    // effective rate identical in real and nominal display modes.
    const lastPoint = realProjectionData[realProjectionData.length - 1]
    const giftTotal = getGiftTotal(plannedGifts, yearsToRetirement, true, inflationRate)
    const portfolioWithdrawal = Math.max(0, (lastPoint.Total ?? 0) - giftTotal) * (withdrawalRate / 100)
    const summary = computeRetirementTaxSummary({
      people: incomePeople,
      rrspAtRetirement: lastPoint.RRSP ?? 0,
      tfsaAtRetirement: lastPoint.TFSA ?? 0,
      portfolioWithdrawal,
    })

    if (showRealValues) return summary
    const inflationFactor = Math.pow(1 + inflationRate / 100, Math.max(0, yearsToRetirement))
    return scaleRetirementTaxSummary(summary, inflationFactor)
  }, [people, realProjectionData, yearsToRetirement, showRealValues, inflationRate, withdrawalRate, plannedGifts])

  return (
    <ProjectionContext.Provider value={{
      compiledPlan, simulation, retirementCashFlow,
      projectionData, conservativeProjectionData, optimisticProjectionData,
      realProjectionData, currentProjectionData: projectionData,
      householdRetirementAge, yearsToRetirement, minCurrentAge,
      totalAnnualIncome, totalAnnualPension, totalAnnualCpp, totalAnnualOas,
      guaranteedIncomeSchedule, totalPortfolio, totalAnnualContributions, retirementTax,
    }}>
      {children}
    </ProjectionContext.Provider>
  )
}

export function useProjectionContext() {
  const ctx = useContext(ProjectionContext)
  if (!ctx) throw new Error('useProjectionContext must be used within ProjectionProvider')
  return ctx
}
