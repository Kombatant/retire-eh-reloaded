import type { AccountType, IncomeStream, ProvinceCode, SpendingStrategy } from '@/lib/plan/schema'

// A market scenario: one value per simulated year (index 0 = plan start year).
// Rates are fractions (0.07 = 7%).
export interface MarketPath {
  // Return of accounts without an allocation (the plan's default portfolio).
  nominalReturn: Float64Array
  inflation: Float64Array
  // Asset-class returns; accounts with an allocation use their weighted mix.
  // Absent in deterministic projections, where expected returns are used.
  assets?: { equity: Float64Array; bond: Float64Array; cash: Float64Array }
  // Total return (price growth + dividends) per stock holding, indexed by
  // CompiledHolding.index. Absent: use each holding's expected return.
  stocks?: Float64Array[]
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
  province: ProvinceCode
  yearsInCanadaAfter18: number
  // Unused contribution room at plan start, plan-start dollars (undefined = not tracked).
  rrspRoom?: number
  tfsaRoom?: number
  // This year's FHSA participation room (undefined = the annual limit) and
  // what is left of the lifetime limit, across all of the person's FHSAs.
  fhsaRoom?: number
  fhsaLifetimeRoom: number
}

export interface CompiledHolding {
  index: number // position in MarketPath.stocks
  symbol: string
  shares: number
  price: number // plan-start price per share
  acb: number // total cost base
  growth: number // expected annual price growth (selected scenario), fraction
  dividendYield: number // fraction of value per year
  dividendEligible: boolean
  volatility: number // fraction
  grants: { offset: number; shares: number }[]
  // Shares are sold at vesting to pay the tax on them (sell to cover).
  sellToCover: boolean
  espp: { flow: CompiledFlow; discount: number; match: number } | null
}

export interface CompiledStockSale {
  kind: 'none' | 'fixedAmount' | 'coverGap'
  amount: number // plan-start dollars per year (fixedAmount)
  startOffset: number
  endOffset: number // exclusive
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
  // Expected nominal return for this account (override, allocation, or plan default).
  expectedReturnPct: number
  // Taxable non-registered or cash account: distributions are taxed yearly
  // and withdrawals realize capital gains against the cost base.
  nonRegistered: boolean
  // Contributions reduce taxable income (RRSP, FHSA).
  deductible: boolean
  initialAcb: number
  // Annual taxable distributions as fractions of the balance.
  yields: { interest: number; eligibleDividends: number; foreignDividends: number }
  // CASH: the whole return is taxable interest.
  interestOnly: boolean
  // RRSP: age at which this account becomes a RRIF (undefined = the plan's).
  rrifConversionAge?: number
  // FHSA: no contributions before this calendar year.
  openedYear?: number
  // LIRA/LIF: the pension rules that set withdrawal limits.
  lockedInJurisdiction?: ProvinceCode | 'FED'
  // Position in the custom withdrawal order (lower is drawn first).
  orderRank: number
  // Asset mix as fractions (allocation accounts; CASH is all cash).
  allocation: { equity: number; bond: number; cash: number } | null
  // Stock portfolio accounts: individual holdings and the sell plan.
  stock: { holdings: CompiledHolding[]; sale: CompiledStockSale } | null
}

export interface CompiledIncome {
  personIndex: number
  kind: IncomeStream['kind']
  taxTreatment: IncomeStream['taxTreatment']
  flow: CompiledFlow
  // One-time receipts (windfalls) are deposited into this account index.
  depositAccount: number
  // DB pensions: share that continues to a surviving spouse.
  survivorFraction: number
  // RSU bonuses are paid in shares. Holding -1: the owner has no stock holding,
  // so the value goes to their non-registered account instead.
  rsu?: { incomeId: string; account: number; holding: number; sellToCover: boolean }
}

// One year's RSU bonus for one income stream, in that year's dollars.
export interface RsuAward {
  incomeId: string
  value: number
  price: number // projected price per share that year, CAD
  shares: number
  sharesKept: number // after selling to cover tax
}

export interface CompiledExpense {
  id: string
  category: string
  essential: boolean
  oneTime: boolean
  flow: CompiledFlow
}

export interface CompiledPhase {
  startOffset: number
  endOffset: number
  multiplier: number
}

export interface CompiledProperty {
  ownerIndex: number
  value: number // plan-start dollars
  appreciationReal: number // fraction per year above inflation
  principalResidence: boolean
  acb: number
  annualCosts: number // plan-start dollars
  saleOffset: number // -1 = never sold
  sellingCost: number // fraction
  replacementValue: number // plan-start dollars
  // Non-registered account that receives the sale proceeds.
  proceedsAccount: number
}

export interface CompiledDebt {
  balance: number
  annualRate: number // fraction
  monthlyPayment: number
  propertyIndex: number // -1 = unsecured
}

// v1 reproduces the original engine (pooled Quebec tax, flat-rate RRSP
// refunds, simple OAS) for parity tests. v2 is the current rule set.
export type RuleSet = 'v1' | 'v2'

export interface CompiledPlan {
  rules: RuleSet
  startYear: number
  years: number // rows simulated: offsets 0..years-1
  // First year the household draws from its portfolio (the last person retires).
  drawdownStartOffset: number
  people: CompiledPerson[]
  accounts: CompiledAccount[]
  holdingCount: number
  incomes: CompiledIncome[]
  expenses: CompiledExpense[]
  expenseMode: 'simple' | 'detailed'
  replacementRate: number // fraction
  surplusPolicy: 'ignore' | 'save'
  phases: CompiledPhase[]
  properties: CompiledProperty[]
  debts: CompiledDebt[]
  // Account that receives saved surpluses (-1 when not saving).
  savingsAccount: number
  // Account that receives forced RRIF/LIF minimums and meltdown cash after tax.
  reinvestAccount: number
  expectedRealReturn: number // fraction, for VPW
  assetReturnsPct: { equity: number; bond: number; cash: number }
  strategy: 'initialPct' | 'expenses'
  spendingStrategy: SpendingStrategy
  withdrawalOrder: 'proRata' | 'custom'
  rrifConversionAge: number
  rrifUseYoungerSpouseAge: boolean
  meltdown: { enabled: boolean; targetTaxableIncome: number } // plan-start dollars
  probate: boolean
  // Simple mode: replacement % × primary salaries in their final working
  // year, plan-start dollars (pre-tax income target in drawdown).
  simpleSpendingTarget: number
  initialWithdrawalRatePct: number
  pensionSplitting: boolean
  // Per person: account index that receives reinvested RRSP refunds (v2), or -1.
  refundTargets: number[]
  expectedReturnPct: number
  inflationPct: number
}

export interface PersonYear {
  age: number
  employment: number
  pension: number
  cpp: number
  oas: number
  gis: number
  otherIncome: number
  registeredWithdrawals: number
  // Eligible pension income received (+) or transferred (−) by splitting.
  pensionSplit: number
  taxableIncome: number
  federal: number
  provincial: number
  tax: number
  oasClawback: number
  payroll: number
  rrspRefund: number
  // Taxable distributions from non-registered and cash accounts.
  investmentIncome: number
  realizedGains: number
  // End-of-year unused room (nominal), NaN when not tracked.
  rrspRoom: number
  tfsaRoom: number
  alive: boolean
  // RRIF/LIF minimum withdrawals required this year.
  minimumWithdrawals: number
  // RSU vesting and ESPP benefits: taxable employment income paid in shares.
  stockCompensation: number
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
  // Recorded withdrawals per account (same order as CompiledPlan.accounts);
  // they add up to `withdrawal`.
  withdrawalsByAccount: number[]
  taxableWithdrawal: number
  taxFreeWithdrawal: number
  // The amount that decides whether the year counts as funded. Detailed mode:
  // unfunded budget, or unfunded essentials for strategies that flex spending
  // by design. Simple mode: the planned withdrawal that could not be made.
  // Unfunded one-time costs count in every mode.
  shortfall: number
  // Detailed mode: the after-tax budget met, and the parts of it left unfunded.
  fundedSpending: number
  budgetShortfall: number
  essentialShortfall: number
  // Strategy's target withdrawal that could not be made.
  withdrawalShortfall: number
  tax: number
  oasClawback: number
  gis: number
  otherIncome: number
  rrspRefunds: number
  investmentIncome: number
  realizedGains: number
  // One-time income and property sale proceeds deposited into accounts.
  deposits: number
  // What a property sale this year adds towards the retirement goal: the cash
  // invested, less any capital gain, whose tax depends on that year's income.
  propertySaleCredit: number
  // Spending need: simple mode = pre-tax income target in drawdown;
  // detailed mode = after-tax spending (items, property costs, debt payments).
  spending: number
  debtPayments: number
  // Detailed mode: cash left after tax, contributions and spending (saved if
  // the surplus policy is 'save'). Negative values were drawn from the portfolio.
  surplus: number
  propertyValue: number
  debtBalance: number
  netWorth: number
  // Extra RRSP/RRIF withdrawals from the meltdown strategy, and forced or
  // meltdown cash reinvested after tax.
  meltdownWithdrawals: number
  reinvested: number
  // Surplus invested under the 'save' policy.
  saved: number
  // Stock portfolio accounts.
  stockValue: number // end of year
  unvestedValue: number // unvested RSUs at this year's price (not in net worth)
  stockSales: number
  stockCompensation: number
  // Vested RSU shares sold at once to pay their own tax (sell to cover).
  // Included in `tax`; this part is paid by the shares, not from cash.
  stockTaxWithheld: number
  rsuAwards: RsuAward[]
  // Pension, CPP, OAS and GIS.
  guaranteedIncome: number
  grossIncome: number
  afterTaxIncome: number
}

// Extra detail computed for the first drawdown year only (tax summary card).
export interface DrawdownSnapshot {
  taxWithoutRegisteredWithdrawals: number
  marginalRatePct: number[]
}

// What is left at the end of the plan, after the last death.
export interface EstateResult {
  year: number
  cpi: number
  grossEstate: number
  // Deemed disposition: registered balances and unrealized gains on the final return.
  finalReturnTax: number
  probate: number
  afterTaxEstate: number
}

export interface SimResult {
  rows: YearRow[]
  snapshot: DrawdownSnapshot | null
  estate: EstateResult | null
  // First offset at which the portfolio is exhausted during drawdown, if any.
  depletionOffset: number | null
}
