import { z } from 'zod'

// Plan data model v2: the canonical persisted and exported shape.
//
// Conventions:
// - Money amounts are entered in plan-start ("today's") dollars unless a field
//   says otherwise. The engine indexes them according to each item's growth rule.
// - Percentages are stored as human percentages (7 means 7%).
// - Dates are TimePoints so they can follow a person ("at Alex's retirement")
//   instead of being frozen to a calendar year.
// - Optional fields carry defaults so hand-edited or partial YAML still loads.

export const PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'] as const
export const provinceSchema = z.enum(PROVINCES)
export type ProvinceCode = z.infer<typeof provinceSchema>

// Kept as the schema default for omitted provinces. Existing plans were always
// taxed as Quebec, so that is the safest fallback until all provinces exist.
export const SCHEMA_DEFAULT_PROVINCE: ProvinceCode = 'QC'

// Maximum CPP retirement pension at age 65 (~$1,508/month in 2026).
export const MAX_CPP_ANNUAL_2026 = 18092

const id = z.string().min(1)
const money = z.number().min(0)
const age = z.number().int().min(0).max(120)
const calendarYear = z.number().int().min(1900).max(2200)
const percent = (min: number, max: number) => z.number().min(min).max(max)

export const timePointSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('now') }),
  z.object({ kind: z.literal('year'), year: calendarYear }),
  z.object({ kind: z.literal('age'), personId: id, age }),
  z.object({ kind: z.literal('retirement'), personId: id, offset: z.number().int().min(-60).max(60).default(0) }),
])
export type TimePoint = z.infer<typeof timePointSchema>

// --- People -----------------------------------------------------------------

const cppSchema = z.discriminatedUnion('mode', [
  // The user enters the age-65 amount from their Service Canada statement.
  z.object({ mode: z.literal('amount'), amountAt65: money }),
  // Estimated from average earnings relative to the YMPE over the contributory period.
  z.object({
    mode: z.literal('earnings'),
    averageEarningsRatioPct: percent(0, 100),
    contributoryYears: z.number().int().min(0).max(50),
  }),
  // Estimated from a simple work history; see estimateCppFromHistory.
  z.object({
    mode: z.literal('history'),
    startedWorkingYear: calendarYear,
    // Typical yearly earnings over the career, in today's dollars.
    // Undefined: use the person's current salary.
    typicalEarnings: money.optional(),
    // Years between starting work and 65 with no CPP/QPP earnings
    // (time abroad, school, unemployment).
    yearsNotWorking: z.number().int().min(0).max(47).default(0),
    // Years at home with a child under 7: dropped from the calculation
    // (child-rearing provision) instead of counting as zero.
    childRearingYears: z.number().int().min(0).max(47).default(0),
  }),
])

export const personSchema = z.object({
  id,
  name: z.string().min(1),
  birthYear: calendarYear,
  province: provinceSchema.default(SCHEMA_DEFAULT_PROVINCE),
  retirementAge: age,
  lifeExpectancy: age.default(95),
  cpp: cppSchema.default({ mode: 'amount', amountAt65: MAX_CPP_ANNUAL_2026 }),
  // Up to 70 for the CPP and 72 for the QPP; the calculation clamps by province.
  cppStartAge: z.number().int().min(60).max(72).default(65),
  oas: z.object({
    startAge: z.number().int().min(65).max(70).default(65),
    yearsInCanadaAfter18: z.number().int().min(0).max(47).default(40),
  }).prefault({}),
  // Unused contribution room as of the plan start. Undefined means "not tracked".
  room: z.object({
    rrsp: money.optional(),
    tfsa: money.optional(),
    fhsa: money.optional(),
  }).optional(),
})
export type PersonV2 = z.infer<typeof personSchema>

// --- Accounts ---------------------------------------------------------------

export const ACCOUNT_TYPES = ['RRSP', 'RRIF', 'TFSA', 'FHSA', 'LIRA', 'LIF', 'NONREG', 'CASH', 'STOCK'] as const
export const accountTypeSchema = z.enum(ACCOUNT_TYPES)
export type AccountType = z.infer<typeof accountTypeSchema>

export const contributionSchema = z.object({
  amount: money,
  from: timePointSchema.optional(), // default: plan start
  to: timePointSchema.optional(), // default: owner's retirement
  // Indexed contributions keep pace with inflation; v1 contributions were flat nominal.
  indexed: z.boolean().default(false),
})
export type ContributionRule = z.infer<typeof contributionSchema>

export const allocationSchema = z.object({
  equity: percent(0, 100),
  bond: percent(0, 100),
  cash: percent(0, 100),
})
export type Allocation = z.infer<typeof allocationSchema>

const accountBase = {
  id,
  ownerId: id, // a person id, or 'joint'
  label: z.string().default(''),
  balance: money,
  contributions: z.array(contributionSchema).default([]),
  allocation: allocationSchema.optional(),
  returnOverridePct: percent(-50, 50).optional(),
}

const lockedInJurisdiction = provinceSchema.or(z.literal('FED')).optional()

// An RRSP can become a RRIF at any age, but no later than the end of the year
// the holder turns 71.
export const RRIF_LATEST_CONVERSION_AGE = 71
export const RRIF_EARLIEST_CONVERSION_AGE = 18
const rrifConversionAge = z.number().int().min(RRIF_EARLIEST_CONVERSION_AGE).max(RRIF_LATEST_CONVERSION_AGE)

// --- Individual stock holdings (stock portfolio account) ---------------------

export const STOCK_SCENARIOS = ['bear', 'base', 'bull', 'custom'] as const

// Fallback USD→CAD rate until the Bank of Canada rate is fetched.
export const DEFAULT_USD_CAD = 1.38
export type StockScenario = (typeof STOCK_SCENARIOS)[number]

// Unvested RSUs/PSUs: shares that vest on a date. The value at vesting is
// employment income and becomes the shares' cost base.
export const rsuGrantSchema = z.object({
  id,
  shares: z.number().min(0),
  vestAt: timePointSchema,
})
export type RsuGrant = z.infer<typeof rsuGrantSchema>

// Employee share purchase plan: payroll contributions buy shares at a
// discount, sometimes with an employer match. The discount and match are a
// taxable employment benefit.
export const esppSchema = z.object({
  annualContribution: money, // employee, plan-start dollars
  discountPct: percent(0, 50).default(15),
  employerMatchPct: percent(0, 200).default(0),
  from: timePointSchema.optional(), // default: now
  to: timePointSchema.optional(), // default: owner's retirement
  indexed: z.boolean().default(true),
})
export type Espp = z.infer<typeof esppSchema>

// The share price is entered in US dollars, whatever the listing, and converted
// to Canadian dollars with the plan's USD→CAD rate (assumptions.usdCad).
export const holdingSchema = z.object({
  id,
  symbol: z.string().default(''),
  shares: z.number().min(0),
  priceUsd: money, // current price per share (USD)
  costPerShare: money.optional(), // average cost per share (CAD); undefined = current price (no gain)
  dividendYieldPct: percent(0, 20).default(0),
  // Canadian eligible dividends get the dividend tax credit; foreign dividends are ordinary income.
  dividendType: z.enum(['eligible', 'foreign']).default('eligible'),
  // Compounded annual price growth (excluding dividends) for each projection case.
  growthPct: z.object({
    bear: percent(-50, 50).default(0),
    base: percent(-50, 50).default(5),
    bull: percent(-50, 100).default(10),
    // Optional so existing plans load unchanged; see scenarioGrowthPct.
    custom: percent(-50, 100).optional(),
  }).prefault({}),
  // Annual standard deviation for Monte Carlo; single stocks are volatile.
  volatilityPct: percent(0, 150).default(30),
  rsuGrants: z.array(rsuGrantSchema).default([]),
  // At vesting, the employer sells enough of the new shares to pay their tax
  // (sell to cover). Off: all shares are kept and the tax is paid in cash.
  sellToCover: z.boolean().default(true),
  espp: esppSchema.optional(),
  // Last market quote used to set `priceUsd`.
  lastQuote: z.object({
    price: z.number().min(0), // in the quote currency
    currency: z.string().min(3).max(3),
    fxToCad: z.number().positive(), // CAD per unit of the quote currency
    asOf: z.string(), // ISO date-time of the quote
    fetchedAt: z.string(), // when this app fetched it
    source: z.string(),
  }).optional(),
})
export type Holding = z.infer<typeof holdingSchema>

// A holding's yearly price growth for a case. Until a custom rate is entered,
// Custom follows Base, so choosing it never jumps to an arbitrary number.
export function scenarioGrowthPct(growth: Holding['growthPct'], scenario: StockScenario): number {
  return growth[scenario] ?? growth.base
}

// Selling stock every year to fund retirement.
export const stockSalePlanSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  // Sell enough to raise this much each year (plan-start dollars).
  z.object({ kind: z.literal('fixedAmount'), amount: money, from: timePointSchema.optional(), to: timePointSchema.optional() }),
  // Sell stock first, before other accounts, to cover what spending needs.
  z.object({ kind: z.literal('coverGap'), from: timePointSchema.optional(), to: timePointSchema.optional() }),
])
export type StockSalePlan = z.infer<typeof stockSalePlanSchema>

export const accountSchema = z.discriminatedUnion('type', [
  // `rrifConversionAge` overrides the plan's setting for this account, so part
  // of an RRSP can convert early by holding it as a separate account.
  z.object({ ...accountBase, type: z.literal('RRSP'), rrifConversionAge: rrifConversionAge.optional() }),
  z.object({ ...accountBase, type: z.literal('RRIF') }),
  z.object({ ...accountBase, type: z.literal('TFSA') }),
  z.object({
    ...accountBase,
    type: z.literal('FHSA'),
    openedYear: calendarYear.optional(),
    lifetimeContributed: money.default(0),
  }),
  z.object({ ...accountBase, type: z.literal('LIRA'), jurisdiction: lockedInJurisdiction }),
  z.object({ ...accountBase, type: z.literal('LIF'), jurisdiction: lockedInJurisdiction }),
  z.object({
    ...accountBase,
    type: z.literal('NONREG'),
    // Adjusted cost base. Undefined means "same as balance" (no unrealized gain).
    acb: money.optional(),
    // Annual distributions as % of balance, taxed each year even if reinvested.
    yields: z.object({
      interestPct: percent(0, 20).default(0),
      eligibleDividendPct: percent(0, 20).default(0),
      foreignDividendPct: percent(0, 20).default(0),
    }).optional(),
  }),
  z.object({ ...accountBase, type: z.literal('CASH') }),
  // A non-registered account of individual stocks. Its balance is derived
  // from the holdings (shares × USD price × USD→CAD rate).
  z.object({
    ...accountBase,
    type: z.literal('STOCK'),
    holdings: z.array(holdingSchema).default([]),
    salePlan: stockSalePlanSchema.default({ kind: 'none' }),
  }),
])
export type AccountV2 = z.infer<typeof accountSchema>

// --- Income -----------------------------------------------------------------

// `bonus` and `rsu` are employment income on the tax return, but stay separate
// from `employment`: only the salary drives CPP estimates and the replacement
// income target. `rsu` is paid in shares, not cash.
export const INCOME_KINDS = ['employment', 'bonus', 'rsu', 'selfEmployment', 'rental', 'dbPension', 'annuity', 'windfall', 'other'] as const

export const growthSchema = z.object({
  // cpi: grows with inflation plus `pct` real; fixed: grows `pct` nominal; none: flat nominal.
  kind: z.enum(['cpi', 'fixed', 'none']),
  pct: percent(-20, 20).default(0),
})
export type GrowthRule = z.infer<typeof growthSchema>

export const incomeSchema = z.object({
  id,
  ownerId: id,
  label: z.string().default(''),
  kind: z.enum(INCOME_KINDS),
  amount: money, // annual amount in plan-start dollars (or the one-time amount)
  frequency: z.enum(['annual', 'oneTime']).default('annual'),
  from: timePointSchema.optional(),
  to: timePointSchema.optional(),
  growth: growthSchema.prefault({ kind: 'cpi' }),
  taxTreatment: z.enum(['ordinary', 'nonTaxable', 'capitalGain', 'eligibleDividend']).default('ordinary'),
  db: z.object({
    indexationPctOfCpi: percent(0, 100).default(100),
    bridge: z.object({ amount: money, untilAge: age }).optional(),
    survivorPct: percent(0, 100).default(60),
  }).optional(),
  // kind 'rsu': the amount is the shares' value at vesting. The share count
  // follows that year's projected price for this holding.
  rsu: z.object({
    holdingId: id.optional(), // undefined = the owner's first stock holding
    sellToCover: z.boolean().default(true),
  }).optional(),
})
export type IncomeStream = z.infer<typeof incomeSchema>

// --- Expenses ---------------------------------------------------------------

export const expenseItemSchema = z.object({
  id,
  label: z.string().default(''),
  category: z.string().default('general'),
  amount: money,
  frequency: z.enum(['annual', 'monthly', 'oneTime', 'everyNYears']).default('annual'),
  everyNYears: z.number().int().min(1).max(50).optional(),
  from: timePointSchema.optional(),
  to: timePointSchema.optional(),
  // Essential spending is the floor that dynamic withdrawal strategies never cut.
  essential: z.boolean().default(true),
  // Off keeps a recurring cost at its stated dollar amount, e.g. a fixed-rate
  // payment. One-time items always stay in today's dollars.
  indexed: z.boolean().default(true),
  // Yearly growth on top of inflation; when not indexed, the whole yearly change.
  realGrowthPct: percent(-20, 20).default(0),
})
export type ExpenseItem = z.infer<typeof expenseItemSchema>

export const expensePhaseSchema = z.object({
  id,
  name: z.string().default(''),
  from: timePointSchema,
  to: timePointSchema.optional(),
  discretionaryMultiplierPct: percent(0, 300).default(100),
})
export type ExpensePhase = z.infer<typeof expensePhaseSchema>

export const GIFT_CATEGORY = 'gift'

export const expensesSchema = z.object({
  // simple: retirement spending is replacementRate % of pre-retirement employment
  // income; only one-time items (e.g. gifts) are added on top.
  // detailed: spending is the sum of all items.
  mode: z.enum(['simple', 'detailed']).default('simple'),
  replacementRate: percent(0, 200).default(70),
  // Detailed mode, working years: invest any cash left after spending and
  // contributions ('save'), or leave it out of the projection ('ignore').
  // Shortfalls are always funded from the portfolio.
  surplusPolicy: z.enum(['ignore', 'save']).default('ignore'),
  phases: z.array(expensePhaseSchema).default([]),
  items: z.array(expenseItemSchema).default([]),
})
export type ExpensePlan = z.infer<typeof expensesSchema>

// --- Real estate & debts ----------------------------------------------------

export const propertySchema = z.object({
  id,
  ownerId: id,
  label: z.string().default(''),
  value: money,
  appreciationRealPct: percent(-20, 20).default(0),
  isPrincipalResidence: z.boolean().default(true),
  acb: money.optional(),
  annualCosts: money.default(0),
  sale: z.object({
    at: timePointSchema,
    sellingCostPct: percent(0, 20).default(5),
    // Value of a replacement home bought with the proceeds (0 = rent afterwards).
    replacementValue: money.default(0),
  }).optional(),
})
export type Property = z.infer<typeof propertySchema>

export const debtSchema = z.object({
  id,
  label: z.string().default(''),
  kind: z.enum(['mortgage', 'loan', 'lineOfCredit', 'other']).default('loan'),
  balance: money,
  interestRatePct: percent(0, 40),
  monthlyPayment: money,
  propertyId: id.optional(),
})
export type Debt = z.infer<typeof debtSchema>

// --- Drawdown ---------------------------------------------------------------

export const spendingStrategySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('expenses') }),
  z.object({ kind: z.literal('initialPct'), ratePct: percent(0.01, 20) }),
  z.object({
    kind: z.literal('pctPortfolio'),
    ratePct: percent(0.01, 20),
    floorPct: percent(0, 100).optional(),
    ceilingPct: percent(100, 300).optional(),
  }),
  z.object({
    kind: z.literal('guytonKlinger'),
    initialRatePct: percent(0.01, 20),
    guardrailPct: percent(1, 100).default(20),
    adjustmentPct: percent(1, 50).default(10),
  }),
  z.object({ kind: z.literal('vpw') }),
])
export type SpendingStrategy = z.infer<typeof spendingStrategySchema>

export const drawdownSchema = z.object({
  strategy: spendingStrategySchema.default({ kind: 'initialPct', ratePct: 4 }),
  order: z.enum(['proRata', 'custom']).default('proRata'),
  // A saved order can predate an account type. Adding it last matches where
  // the engine already ranks unlisted types, and puts it on screen to reorder.
  customOrder: z.array(accountTypeSchema)
    .default(['CASH', 'STOCK', 'NONREG', 'RRIF', 'RRSP', 'LIF', 'LIRA', 'FHSA', 'TFSA'])
    .transform(order => [...order, ...ACCOUNT_TYPES.filter(type => !order.includes(type))]),
  rrifConversionAge: rrifConversionAge.default(RRIF_LATEST_CONVERSION_AGE),
  rrifUseYoungerSpouseAge: z.boolean().default(false),
  meltdown: z.object({
    enabled: z.boolean().default(false),
    targetTaxableIncome: money.default(57000),
  }).prefault({}),
  // How to invest the non-registered account the plan creates to receive
  // reinvested money, for plans without one of their own to use.
  reinvestGrowth: z.object({
    allocation: allocationSchema.optional(),
    returnOverridePct: percent(-50, 50).optional(),
  }).prefault({}),
  pensionSplitting: z.boolean().default(true),
})
export type DrawdownSettings = z.infer<typeof drawdownSchema>

// --- Assumptions ------------------------------------------------------------

export const assumptionsSchema = z.object({
  expectedReturn: percent(-10, 50).default(7),
  inflationRate: percent(0, 30).default(2.5),
  // Marginal rate while working; used only to estimate RRSP refunds until the
  // tax engine computes working-year tax directly.
  workingMarginalTaxRate: percent(0, 60).default(30),
  reinvestRrspRefund: z.boolean().default(false),
  // Which price-growth case to use for individual stocks in projections.
  stockScenario: z.enum(STOCK_SCENARIOS).default('base'),
  // Canadian dollars per US dollar, for stock prices. Projections hold it
  // constant. Updated from the Bank of Canada's daily rate when prices refresh.
  usdCad: z.object({
    rate: z.number().positive().default(DEFAULT_USD_CAD),
    asOf: z.string().optional(), // date of the Bank of Canada observation
  }).prefault({}),
  // Long-run compounded nominal returns per asset class, used for accounts with an
  // allocation. Defaults follow the FP Canada projection assumption guidelines.
  assetReturns: z.object({
    equityPct: percent(-10, 30).default(6.6),
    bondPct: percent(-10, 30).default(3.4),
    cashPct: percent(-10, 30).default(2.4),
  }).prefault({}),
  // Market uncertainty for Monte Carlo (annual standard deviations, %).
  simulation: z.object({
    runs: z.number().int().min(50).max(5000).default(500),
    seed: z.number().int().min(0).default(2026),
    portfolioVolPct: percent(0, 50).default(11),
    equityVolPct: percent(0, 60).default(16),
    bondVolPct: percent(0, 30).default(6),
    cashVolPct: percent(0, 10).default(1),
    stochasticInflation: z.boolean().default(true),
    inflationVolPct: percent(0, 10).default(1.2),
    // Year-to-year persistence of inflation shocks (AR(1) coefficient).
    inflationPersistence: z.number().min(0).max(0.95).default(0.6),
    // Mix used for accounts without an allocation in historical backtests.
    historicalMix: z.object({
      equity: percent(0, 100).default(60),
      bond: percent(0, 100).default(40),
      cash: percent(0, 100).default(0),
    }).prefault({}),
  }).prefault({}),
})
export type AssumptionsV2 = z.infer<typeof assumptionsSchema>

// --- Estate -----------------------------------------------------------------

export const estateSchema = z.object({
  // Include provincial probate fees in the after-tax legacy estimate.
  probate: z.boolean().default(true),
})
export type EstateSettings = z.infer<typeof estateSchema>

// --- Plan -------------------------------------------------------------------

export const planSchema = z.object({
  schemaVersion: z.literal(2),
  id,
  name: z.string().min(1).default('My plan'),
  // ISO date the balances were entered.
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  people: z.array(personSchema).min(1),
  accounts: z.array(accountSchema).default([]),
  incomes: z.array(incomeSchema).default([]),
  expenses: expensesSchema.prefault({}),
  properties: z.array(propertySchema).default([]),
  debts: z.array(debtSchema).default([]),
  drawdown: drawdownSchema.prefault({}),
  assumptions: assumptionsSchema.prefault({}),
  estate: estateSchema.prefault({}),
}).superRefine((plan, ctx) => {
  const personIds = new Set(plan.people.map(p => p.id))
  if (personIds.size !== plan.people.length) {
    ctx.addIssue({ code: 'custom', path: ['people'], message: 'Person ids must be unique' })
  }
  const owners: [string, { ownerId: string }[]][] = [
    ['accounts', plan.accounts],
    ['incomes', plan.incomes],
    ['properties', plan.properties],
  ]
  for (const [key, items] of owners) {
    items.forEach((item, i) => {
      if (item.ownerId !== 'joint' && !personIds.has(item.ownerId)) {
        ctx.addIssue({ code: 'custom', path: [key, i, 'ownerId'], message: `Unknown owner "${item.ownerId}"` })
      }
    })
  }
})
export type PlanV2 = z.infer<typeof planSchema>
export type PlanV2Input = z.input<typeof planSchema>

export const uiPrefsSchema = z.object({
  showRealValues: z.boolean().default(true),
  // Essentials hides rarely needed inputs and views; hidden values still apply.
  detailLevel: z.enum(['essentials', 'advanced']).default('essentials'),
})
export type UiPrefs = z.infer<typeof uiPrefsSchema>
