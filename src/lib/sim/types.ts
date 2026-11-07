import type { AccountType, IncomeStream } from '@/lib/plan/schema'

// A market scenario: one value per simulated year (index 0 = plan start year).
// Rates are fractions (0.07 = 7%).
export interface MarketPath {
  nominalReturn: Float64Array
  inflation: Float64Array
}

// A cash amount that is active for years [startOffset, endOffset).
export interface CompiledFlow {
  startOffset: number
  endOffset: number
  amount: number
  // real: amount is in plan-start dollars and follows CPI (times real growth).
  // nominal: amount compounds at ratePct regardless of inflation.
  basis: 'real' | 'nominal'
  ratePct: number
  // Repeat every N years from startOffset (1 = every year in range).
  everyN: number
  // Defined-benefit pensions indexed to only part of CPI once in payment.
  indexFracInPayment?: number
}

export interface CompiledPerson {
  id: string
  name: string
  birthYear: number
  retirementOffset: number
  endOffset: number
  cppAt65: number // plan-start dollars
  cppStartAge: number
  oasStartAge: number
}

export interface CompiledAccount {
  id: string
  type: AccountType
  ownerIndex: number // -1 = joint
  // Withdrawals are fully taxable income (registered retirement accounts).
  taxable: boolean
  initialBalance: number
  contributions: CompiledFlow[]
  // Created by the compiler (e.g. to receive reinvested RRSP refunds).
  synthetic: boolean
}

export interface CompiledIncome {
  personIndex: number
  kind: IncomeStream['kind']
  flow: CompiledFlow
}

export interface CompiledExpense {
  id: string
  category: string
  essential: boolean
  oneTime: boolean
  flow: CompiledFlow
}

export interface CompiledPlan {
  startYear: number
  years: number // rows simulated: offsets 0..years-1
  // First year the household draws from its portfolio (the last person retires).
  drawdownStartOffset: number
  people: CompiledPerson[]
  accounts: CompiledAccount[]
  incomes: CompiledIncome[]
  expenses: CompiledExpense[]
  initialWithdrawalRatePct: number
  expectedReturnPct: number
  inflationPct: number
}

export interface PersonYear {
  age: number
  employment: number
  pension: number
  cpp: number
  oas: number
  tax: number
  oasClawback: number
}

// All money is nominal; divide by `cpi` for plan-start dollars.
export interface YearRow {
  offset: number
  year: number
  cpi: number
  // Price index at the end of the year, for valuing end-of-year balances.
  cpiEnd: number
  phase: 'accumulation' | 'drawdown'
  people: PersonYear[]
  balancesStart: number[]
  balancesEnd: number[]
  contributions: number
  oneTimeExpenses: number
  withdrawal: number
  taxableWithdrawal: number
  taxFreeWithdrawal: number
  // Planned withdrawal the portfolio could not fund.
  shortfall: number
  tax: number
  oasClawback: number
  guaranteedIncome: number
  grossIncome: number
  afterTaxIncome: number
}

export interface SimResult {
  rows: YearRow[]
  // First offset at which the portfolio is exhausted during drawdown, if any.
  depletionOffset: number | null
}
