import { STOCK_SCENARIOS, type PlanV2, type StockScenario } from '@/lib/plan/schema'
import { compilePlan } from '@/lib/sim/compile'
import { simulate } from '@/lib/sim/simulate'
import { deterministicPath } from '@/lib/sim/paths/deterministic'
import { runSucceeded } from '@/lib/sim/risk'

export interface StockOutcome {
  stockAtRetirement: number // real
  stockAtEnd: number // real
  totalSales: number // real, stock sold over the plan
  realizedGains: number // real
  lifetimeTax: number // real, including the final return
  success: boolean
  firstShortfallYear: number | null
  afterTaxEstate: number // real
}

export interface StockScenarioRow {
  scenario: StockScenario
  withPlan: StockOutcome
  noSales: StockOutcome
}

export function hasStock(plan: PlanV2): boolean {
  return plan.accounts.some(a => a.type === 'STOCK')
}

export function hasSalePlan(plan: PlanV2): boolean {
  return plan.accounts.some(a => a.type === 'STOCK' && a.salePlan.kind !== 'none')
}

function outcome(plan: PlanV2, startYear: number): StockOutcome {
  const c = compilePlan(plan, { startYear })
  const result = simulate(c, deterministicPath(c.years, c.expectedReturnPct, c.inflationPct))
  const rows = result.rows
  const atRetirement = rows[Math.min(c.drawdownStartOffset, rows.length - 1)]
  const short = rows.find(r => r.shortfall > Math.max(100 * r.cpi, 0.01 * (r.withdrawal + r.shortfall)))
  const last = rows[rows.length - 1]
  const estate = result.estate
  return {
    stockAtRetirement: atRetirement.stockValue / atRetirement.cpiEnd,
    stockAtEnd: last.stockValue / last.cpiEnd,
    totalSales: rows.reduce((s, r) => s + r.stockSales / r.cpi, 0),
    realizedGains: rows.reduce((s, r) => s + r.realizedGains / r.cpi, 0),
    lifetimeTax: rows.reduce((s, r) => s + r.tax / r.cpi, 0) + (estate ? estate.finalReturnTax / estate.cpi : 0),
    success: runSucceeded(result),
    firstShortfallYear: short ? short.year : null,
    afterTaxEstate: estate ? estate.afterTaxEstate / estate.cpi : 0,
  }
}

// Each price case, with the plan's stock sell plan and with no planned sales.
export function compareStockScenarios(plan: PlanV2, startYear: number): StockScenarioRow[] {
  const withoutSales: PlanV2 = {
    ...plan,
    accounts: plan.accounts.map(a => (a.type === 'STOCK' ? { ...a, salePlan: { kind: 'none' as const } } : a)),
  }
  // Custom is only worth a row when it's the case the plan is actually using.
  const cases = STOCK_SCENARIOS.filter(s => s !== 'custom' || plan.assumptions.stockScenario === 'custom')
  return cases.map(scenario => {
    const pick = (p: PlanV2): PlanV2 => ({ ...p, assumptions: { ...p.assumptions, stockScenario: scenario } })
    return {
      scenario,
      withPlan: outcome(pick(plan), startYear),
      noSales: outcome(pick(withoutSales), startYear),
    }
  })
}
