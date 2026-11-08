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
import { buildGuaranteedIncomeSchedule, getCppIncomeAtAge, getOasIncomeAtAge } from '@/lib/calculations'
import { OAS_MAX_ANNUAL_2026 } from '@/lib/tax'
import { buildRetirementTaxSnapshot, type RetirementTaxSnapshot } from '@/lib/sim/taxSnapshot'
import { retirementSpendingTarget as spendingTargetOf } from '@/lib/insights/outlook'
import type { ProjectionDataPoint } from '@/types/projection'

interface ProjectionContextValueTyped {
  // Unified engine output for the active plan at its expected return.
  compiledPlan: CompiledPlan
  simulation: SimResult
  // The same plan at 2 points below and above the expected return.
  conservativeSimulation: SimResult
  optimisticSimulation: SimResult
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
  retirementSpendingTarget: number
  totalAnnualPension: number
  totalAnnualCpp: number
  totalAnnualOas: number
  guaranteedIncomeSchedule: number[]
  totalPortfolio: number
  totalAnnualContributions: number
  retirementTax: RetirementTaxSnapshot | null
}

const ProjectionContext = createContext<ProjectionContextValueTyped | null>(null)

export function ProjectionProvider({ children }: { children: ReactNode }) {
  const { people } = usePeople()
  const { expectedReturn, showRealValues } = useAssumptions()

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
  const retirementSpendingTarget = spendingTargetOf(compiledPlan, simulation)
  const totalAnnualPension = people.reduce((sum, p) => sum + (p.annualPension || 0), 0)
  const totalAnnualCpp = people.reduce((sum, p) => {
    const ageAtHouseholdRetirement = p.currentAge + yearsToRetirement
    return sum + getCppIncomeAtAge(p.annualCpp, p.cppStartAge, ageAtHouseholdRetirement)
  }, 0)
  const totalAnnualOas = people.reduce((sum, p) => {
    const ageAtRetirement = p.currentAge + yearsToRetirement
    return sum + getOasIncomeAtAge(OAS_MAX_ANNUAL_2026, p.oasStartAge, ageAtRetirement)
  }, 0)
  // All account types count, not only the RRSP/TFSA shown by the v1 forms.
  const totalPortfolio = activePlan.accounts.reduce((sum, acc) => sum + (acc.balance || 0), 0)
  const totalAnnualContributions = activePlan.accounts.reduce((sum, acc) => sum + (acc.contributions[0]?.amount ?? 0), 0)

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

  const retirementTax = useMemo(
    () => (people.length ? buildRetirementTaxSnapshot(compiledPlan, simulation, showRealValues) : null),
    [people.length, compiledPlan, simulation, showRealValues],
  )

  return (
    <ProjectionContext.Provider value={{
      compiledPlan, simulation, conservativeSimulation, optimisticSimulation, retirementCashFlow,
      projectionData, conservativeProjectionData, optimisticProjectionData,
      realProjectionData, currentProjectionData: projectionData,
      householdRetirementAge, yearsToRetirement, minCurrentAge,
      totalAnnualIncome, retirementSpendingTarget, totalAnnualPension, totalAnnualCpp, totalAnnualOas,
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
