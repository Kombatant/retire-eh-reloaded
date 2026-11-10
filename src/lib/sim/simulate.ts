import { getCppIncomeAtAge, getOasIncomeAtAge, maxPensionStartAge } from '@/lib/calculations'
import { computeRetirementTaxSummary, OAS_MAX_ANNUAL_2026 } from '@/lib/tax/quebecLegacy'
import { computeHouseholdTax, type HouseholdTaxResult } from '@/lib/tax/household'
import { CAPITAL_GAINS_INCLUSION, computeIncomeTax, emptyIncome, marginalTaxRate, type IncomeTaxInput } from '@/lib/tax/personal'
import { TAX_2026 } from '@/lib/tax/data/2026'
import { probateFee } from '@/lib/tax/probate'
import { provinceRealValues, type RealValues } from '@/lib/tax/indexation'
import { RRIF_LATEST_CONVERSION_AGE } from '@/lib/plan/schema'
import { oasAnnualAmount } from '@/lib/benefits/oas'
import { gisAnnual } from '@/lib/benefits/gis'
import { cppSurvivorBenefit } from '@/lib/benefits/cpp'
import { calculateFutureValue, sum } from './math'
import { amortizeYear } from './steps/debts'
import { solveIncreasing } from './steps/solver'
import { LIF_EARLIEST_AGE, lifMaximumFactor, rrifMinimumFactor } from './steps/rrif'
import { strategyWithdrawal, type StrategyState } from './steps/spendingStrategy'
import type { CompiledAccount, CompiledFlow, CompiledPlan, DrawdownSnapshot, EstateResult, MarketPath, PersonYear, RsuAward, SimResult, YearRow } from './types'
import type { ProvinceCode } from '@/lib/plan/schema'

const DIVIDEND_GROSS_UP = 1 + TAX_2026.federal.eligibleDividendGrossUp
const LIMITS = TAX_2026.limits

// Cumulative price index: cpi[t] converts plan-start dollars to year-t dollars.
export function cumulativeCpi(inflation: Float64Array, years: number): Float64Array {
  const cpi = new Float64Array(years)
  cpi[0] = 1
  for (let t = 1; t < years; t++) cpi[t] = cpi[t - 1] * (1 + (inflation[t - 1] ?? 0))
  return cpi
}

// Nominal value of a flow in every simulated year for one market path.
export function flowSeries(flow: CompiledFlow, cpi: Float64Array, inflation: Float64Array): Float64Array {
  const years = cpi.length
  const out = new Float64Array(years)
  const start = Math.max(0, flow.startOffset)
  const end = Math.min(years, flow.endOffset)
  const growth = 1 + flow.ratePct / 100
  for (let t = start; t < end; t++) {
    if ((t - flow.startOffset) % flow.everyN !== 0) continue
    const base = flow.amount * Math.pow(growth, t)
    out[t] = flow.basis === 'real' ? base * cpi[t] : base
  }
  // Partially indexed DB pensions: full CPI until payments begin, then only
  // the indexed fraction of each year's inflation.
  if (flow.indexFracInPayment !== undefined && start < end) {
    let value = out[start]
    for (let t = start + 1; t < end; t++) {
      value *= 1 + flow.indexFracInPayment * (inflation[t - 1] ?? 0)
      out[t] = value
    }
  }
  return out
}

function addInto(target: Float64Array, source: Float64Array, scale = 1, fromOffset = 0) {
  for (let i = Math.max(0, fromOffset); i < target.length; i++) target[i] += source[i] * scale
}

type ReceiptBucket = 'employment' | 'selfEmployment' | 'pension' | 'otherOrdinary' | 'eligibleDividends' | 'capitalGains'

interface IncomeBuckets {
  employment: Float64Array
  selfEmployment: Float64Array
  pension: Float64Array
  otherOrdinary: Float64Array
  eligibleDividends: Float64Array
  capitalGains: Float64Array
  nonTaxable: Float64Array
  // One-time receipts that are invested rather than spent.
  deposited: Float64Array
  // The taxable part of `deposited`, by the bucket it is taxed in. Simple mode
  // invests receipts net of their tax, so it needs the tax with and without them.
  receipts: Record<ReceiptBucket, Float64Array>
}

// A flow that recurs through the year is prorated in a partial first period.
// One-time amounts and costs every few years are dated events: paid in full.
function scaleFirstPeriodFlow(series: Float64Array, flow: CompiledFlow, fraction: number, oneTime = false): Float64Array {
  if (fraction < 1 && !oneTime && flow.everyN === 1) series[0] *= fraction
  return series
}

function bucketIncomes(c: CompiledPlan, cpi: Float64Array, inflation: Float64Array, depositSeries: Float64Array[]): IncomeBuckets[] {
  const years = c.years
  const buckets: IncomeBuckets[] = c.people.map(() => ({
    employment: new Float64Array(years),
    selfEmployment: new Float64Array(years),
    pension: new Float64Array(years),
    otherOrdinary: new Float64Array(years),
    eligibleDividends: new Float64Array(years),
    capitalGains: new Float64Array(years),
    nonTaxable: new Float64Array(years),
    deposited: new Float64Array(years),
    receipts: {
      employment: new Float64Array(years),
      selfEmployment: new Float64Array(years),
      pension: new Float64Array(years),
      otherOrdinary: new Float64Array(years),
      eligibleDividends: new Float64Array(years),
      capitalGains: new Float64Array(years),
    },
  }))
  for (const income of c.incomes) {
    // Paid in shares, not cash: handled with the other stock compensation.
    if (income.kind === 'rsu') continue
    const series = scaleFirstPeriodFlow(flowSeries(income.flow, cpi, inflation), income.flow, c.firstPeriodFraction, income.oneTime)
    const b = buckets[income.personIndex]
    const bucket: ReceiptBucket | 'nonTaxable' =
      income.taxTreatment === 'nonTaxable' ? 'nonTaxable'
        : income.taxTreatment === 'capitalGain' ? 'capitalGains'
          : income.taxTreatment === 'eligibleDividend' ? 'eligibleDividends'
            : income.kind === 'employment' || income.kind === 'bonus' ? 'employment'
              : income.kind === 'selfEmployment' ? 'selfEmployment'
                : income.kind === 'dbPension' || income.kind === 'annuity' ? 'pension'
                  : 'otherOrdinary'
    addInto(b[bucket], series)
    if (income.depositAccount >= 0) {
      addInto(b.deposited, series)
      addInto(depositSeries[income.depositAccount], series)
      if (bucket !== 'nonTaxable') addInto(b.receipts[bucket], series)
    }
    // A DB survivor pension continues to the spouse after the owner dies.
    if (income.survivorFraction > 0 && c.people.length === 2) {
      const spouse = buckets[1 - income.personIndex]
      addInto(spouse.pension, series, income.survivorFraction, c.people[income.personIndex].endOffset + 1)
    }
  }
  return buckets
}

// In a partial first year, the parts of a person's income that are one-time
// events rather than a share of a year's steady income (see `householdTax`).
interface OneTimeIncome {
  employment: number
  selfEmployment: number
  pension: number
  registered: number
  nonEligible: number
  otherOrdinary: number
  eligibleDividends: number
  capitalGains: number
}

type TaxMember = Omit<IncomeTaxInput, 'pensionSplit'> & { oneTime?: OneTimeIncome }

// What counts as income for GIS, in the three parts the benefit treats apart.
function gisIncomeOf(m: TaxMember): { employment: number; pension: number; other: number } {
  return {
    employment: m.employment + (m.selfEmployment ?? 0),
    pension: m.pension,
    other: m.registeredWithdrawals + m.cpp + m.otherOrdinary + m.eligibleDividends * DIVIDEND_GROSS_UP + m.capitalGains * CAPITAL_GAINS_INCLUSION,
  }
}

// One member's income for a full year at the steady pace of a partial first
// year, with one-time items once (or left out, for the recurring-only return).
function annualizedMember(m: TaxMember, fraction: number, withOneTime: boolean): TaxMember {
  const once = m.oneTime
  const whole = (value: number, oneTime = 0) => (value - oneTime) / fraction + (withOneTime ? oneTime : 0)
  const oneTimeGains = Math.min(m.capitalGains, once?.capitalGains ?? 0)
  return {
    ...m,
    employment: whole(m.employment, once?.employment),
    selfEmployment: whole(m.selfEmployment ?? 0, once?.selfEmployment),
    pension: whole(m.pension, once?.pension),
    registeredWithdrawals: whole(m.registeredWithdrawals, once?.registered),
    nonEligibleRegistered: whole(m.nonEligibleRegistered ?? 0, once?.nonEligible),
    cpp: m.cpp / fraction,
    oas: m.oas / fraction,
    otherOrdinary: whole(m.otherOrdinary, once?.otherOrdinary),
    eligibleDividends: whole(m.eligibleDividends, once?.eligibleDividends),
    capitalGains: whole(m.capitalGains, oneTimeGains),
    rrspDeduction: m.rrspDeduction / fraction,
    oneTime: undefined,
  }
}

interface PlannedWithdrawal {
  taken: number[]
  registered: number[] // per person
  // Part of `registered` that is not eligible pension income.
  nonEligible: number[] // per person
  gains: number[] // per person
  // Taxable distributions this withdrawal avoids, because money taken out at
  // the start of the year earns nothing that year.
  cutOrdinary: number[] // per person
  cutEligible: number[] // per person
}

// One account's return in year t. Accounts with an asset mix follow the
// asset-class paths when the scenario has them; others follow the default
// portfolio path, offset by their expected-return spread.
export function accountReturnAt(c: CompiledPlan, a: CompiledAccount, path: MarketPath, t: number): number {
  const period = t === 0 ? c.firstPeriodFraction : 1
  const mix = a.allocation
  if (mix && path.assets) {
    return mix.equity * path.assets.equity[t] + mix.bond * path.assets.bond[t] + mix.cash * path.assets.cash[t]
  }
  // A spread can otherwise push a bad year below a total loss.
  return Math.max(-1, (path.nominalReturn[t] ?? 0) + ((a.expectedReturnPct - c.expectedReturnPct) / 100) * period)
}

// Year-by-year household simulation in nominal dollars.
//
// Conventions kept from the original engine:
// - Before the household starts drawing down (when its last member retires),
//   contributions are monthly. Under v2 a year's growth equals that year's
//   annual return; v1 kept the original nominal rate / 12.
// - In drawdown, the year's withdrawal comes out at the start of the year and
//   the remainder grows at the annual nominal rate.
// - Tax is computed in plan-start dollars with today's rules, which is
//   equivalent to fully indexed brackets. Jurisdictions that freeze their
//   thresholds get bracket creep through the tax engine's deflator.
//
// Spending:
// - Simple mode (the original model): the withdrawal follows the drawdown
//   strategy. Gifts are paid on their date from the portfolio, grossed up for
//   tax (v1 reserved them as a pot at the start of drawdown).
// - Detailed mode: spending is the sum of expense items, property costs and
//   debt payments in every year. Working-year shortfalls are drawn from the
//   portfolio (grossed up for tax); surpluses are saved if the plan says so.
//   The "expenses" strategy withdraws exactly what after-tax spending needs;
//   other strategies never cut below essential spending.
//
// One-time costs that the portfolio pays directly (gifts, debt left after a
// property sale, a replacement home) go through fundOneOff, so they are
// withdrawn, taxed and reported once like any other withdrawal.
//
// Registered accounts: RRSPs convert to RRIFs at the conversion age and then
// pay at least the RRIF minimum; LIRAs unlock as LIFs (minimum and maximum).
// Forced or meltdown withdrawals not needed for spending are reinvested.
//
// Deaths (v2): a person's income stops after their life expectancy. Their
// accounts roll over to the surviving spouse tax-free; DB survivor pensions
// and the CPP survivor's pension continue. At the end of the plan the estate
// is taxed as a deemed disposition, less probate.
//
// v1 rules reproduce the original engine for parity tests.
export function simulate(c: CompiledPlan, path: MarketPath): SimResult {
  const years = c.years
  const D = c.drawdownStartOffset
  const v2 = c.rules === 'v2'
  const detailed = c.expenseMode === 'detailed'
  const cpi = cumulativeCpi(path.inflation, years)
  const accountCount = c.accounts.length
  const peopleCount = c.people.length
  const zeros = (): number[] => new Array(peopleCount).fill(0)
  const isAlive = (i: number, t: number) => !v2 || t <= c.people[i].endOffset

  const firstPeriod = c.firstPeriodFraction
  const contributionSeries = c.accounts.map(a => {
    const total = new Float64Array(years)
    for (const flow of a.contributions) addInto(total, scaleFirstPeriodFlow(flowSeries(flow, cpi, path.inflation), flow, firstPeriod))
    return total
  })
  const depositSeries = c.accounts.map(() => new Float64Array(years))
  const incomeByPerson = bucketIncomes(c, cpi, path.inflation, depositSeries)
  const rsuBonuses = c.incomes.flatMap(i => (i.rsu
    ? [{ ...i.rsu, employee: i.personIndex, series: scaleFirstPeriodFlow(flowSeries(i.flow, cpi, path.inflation), i.flow, firstPeriod, i.oneTime) }]
    : []))

  // Spending series (detailed mode) and the simple-mode reserved gift pot.
  const essentialSpending = new Float64Array(years)
  const discretionarySpending = new Float64Array(years)
  const oneTimePot = new Float64Array(years)
  // Detailed mode's one-time items, kept apart from the recurring ones: they
  // don't shrink for a survivor.
  const oneTimeEssential = new Float64Array(years)
  const oneTimeDiscretionary = new Float64Array(years)
  for (const expense of c.expenses) {
    if (!detailed && expense.oneTime) {
      // One-time expenses before drawdown are reserved and paid at the start
      // of drawdown, in that year's dollars.
      const start = expense.flow.startOffset
      if (start < 0 || start >= years) continue
      const at = v2 ? start : Math.max(start, D)
      if (at >= years) continue
      oneTimePot[at] += expense.flow.amount * Math.pow(1 + expense.flow.ratePct / 100, start) * cpi[at]
      continue
    }
    if (!detailed) continue
    const series = scaleFirstPeriodFlow(flowSeries(expense.flow, cpi, path.inflation), expense.flow, firstPeriod, expense.oneTime)
    if (expense.oneTime) addInto(expense.essential ? oneTimeEssential : oneTimeDiscretionary, series)
    else addInto(expense.essential ? essentialSpending : discretionarySpending, series)
  }
  // Phases usually have no end date, so they overlap. The one that started most
  // recently wins: each percentage is of the full flexible budget, and multiplying
  // them would make "70%, then 65%" mean 45.5%.
  const phaseMultiplier = new Float64Array(years).fill(1)
  for (const phase of [...c.phases].sort((a, b) => a.startOffset - b.startOffset)) {
    for (let t = Math.max(0, phase.startOffset); t < Math.min(years, phase.endOffset); t++) phaseMultiplier[t] = phase.multiplier
  }

  const balances = c.accounts.map(a => Math.max(0, a.initialBalance))
  const acb = c.accounts.map(a => Math.max(0, a.initialAcb))
  // One ledger per person: the limits apply across all of their FHSAs.
  const fhsaYearRoom = c.people.map(p => p.fhsaRoom ?? LIMITS.fhsaAnnual)
  const fhsaLifetime = c.people.map(p => p.fhsaLifetimeRoom)
  // Ownership changes when a spouse dies (rollover).
  const owner = c.accounts.map(a => a.ownerIndex)
  // Stock portfolios: value and price per holding. Generic account operations
  // (withdrawals, contributions) change the account balance; holdings are
  // then rescaled in proportion, which is how a pro-rata sale works.
  const stockAccounts = c.accounts.flatMap((a, i) => (a.stock ? [i] : []))
  const holdingValue = new Float64Array(c.holdingCount)
  const holdingPrice = new Float64Array(c.holdingCount)
  const esppSeries: Float64Array[] = []
  for (const a of stockAccounts) {
    for (const h of c.accounts[a].stock!.holdings) {
      holdingValue[h.index] = h.shares * h.price
      holdingPrice[h.index] = h.price
      esppSeries[h.index] = h.espp ? scaleFirstPeriodFlow(flowSeries(h.espp.flow, cpi, path.inflation), h.espp.flow, firstPeriod) : new Float64Array(years)
    }
  }
  const holdingsTotal = (a: number) => c.accounts[a].stock!.holdings.reduce((s, h) => s + holdingValue[h.index], 0)
  const syncHoldings = (a: number) => {
    const holdings = c.accounts[a].stock?.holdings
    if (!holdings || holdings.length === 0) return
    const total = holdingsTotal(a)
    if (total > 0) {
      const scale = balances[a] / total
      for (const h of holdings) holdingValue[h.index] *= scale
    } else {
      for (const h of holdings) holdingValue[h.index] = balances[a] / holdings.length
    }
  }
  const growStock = (a: number, t: number) => {
    // An account with no holdings has nothing to price, but can still hold money.
    if (c.accounts[a].stock!.holdings.length === 0) {
      balances[a] *= 1 + (path.nominalReturn[t] ?? 0)
      return
    }
    for (const h of c.accounts[a].stock!.holdings) {
      const period = t === 0 ? firstPeriod : 1
      const r = path.stocks?.[h.index]?.[t] ?? Math.pow(1 + h.growth + h.dividendYield, period) - 1
      holdingValue[h.index] *= 1 + r
      holdingPrice[h.index] *= Math.max(0, 1 + r - h.dividendYield * period)
    }
    balances[a] = holdingsTotal(a)
  }

  const propertyValue = c.properties.map(p => p.value)
  const propertyAcb = c.properties.map(p => p.acb)
  const propertyOwned = c.properties.map(() => true)
  const propertyOwner = c.properties.map(p => p.ownerIndex)
  const debtBalance = c.debts.map(d => d.balance)

  // Contribution room in nominal dollars. RRSP room is always ledgered: without
  // a real figure it starts with no carry-forward and earns new room each year,
  // so an untracked person is capped at an estimate. TFSA room is NaN when not tracked.
  const rrspRoom = c.people.map(p => p.rrspRoom ?? 0)
  const tfsaRoom = c.people.map(p => (p.tfsaRoom === undefined ? NaN : p.tfsaRoom))
  let priorTfsaWithdrawals = zeros()
  // Net capital losses carried forward, per person, nominal.
  const lossCarry = zeros()
  // A LIRA is treated as converted to a LIF from the first year it pays.
  const liraPaying = c.accounts.map(() => false)
  // What the last year's returns contained, for the deemed disposition at death.
  let finalInputs: TaxMember[] = []
  // Each person's income last year, in that year's real dollars, for GIS.
  const priorGisIncome: ({ employment: number; pension: number; other: number } | null)[] = c.people.map(() => null)
  let finalAlive: number[] = []
  // What each province's amounts are worth in each year on this market path.
  const realValuesByProvince = new Map<ProvinceCode, RealValues[]>()
  for (const p of c.people) {
    if (!realValuesByProvince.has(p.province)) {
      realValuesByProvince.set(p.province, provinceRealValues(TAX_2026.provinces[p.province], c.startYear, cpi, path.inflation))
    }
  }

  const rows: YearRow[] = []
  let depletionOffset: number | null = null
  let snapshot: DrawdownSnapshot | null = null
  const strategy: StrategyState = { initialWithdrawal: 0, initialRate: c.initialWithdrawalRatePct / 100, lastWithdrawal: 0, lastReturn: 0, lastInflation: 0 }

  for (let t = 0; t < years; t++) {
    const r = path.nominalReturn[t] ?? 0
    const k = cpi[t]
    // Below 1 only in a partial first year.
    const period = t === 0 ? firstPeriod : 1
    const accountReturn = c.accounts.map(a => accountReturnAt(c, a, path, t))
    const alive = c.people.map((_, i) => isAlive(i, t))
    const aliveIdx = alive.flatMap((a, i) => (a ? [i] : []))

    // Spousal rollover: the first year after a death, the survivor takes
    // over the deceased's accounts and property.
    if (v2 && aliveIdx.length > 0) {
      for (let a = 0; a < accountCount; a++) if (owner[a] >= 0 && !alive[owner[a]]) owner[a] = aliveIdx[0]
      for (let p = 0; p < propertyOwner.length; p++) if (propertyOwner[p] >= 0 && !alive[propertyOwner[p]]) propertyOwner[p] = aliveIdx[0]
    }
    const balancesStart = balances.slice()

    const peopleYear: PersonYear[] = c.people.map((p, i) => {
      const age = c.startYear + t - p.birthYear
      const income = incomeByPerson[i]
      const live = alive[i] ? 1 : 0
      const oasReal = v2
        ? oasAnnualAmount({ age, startAge: p.oasStartAge, yearsInCanadaAfter18: p.yearsInCanadaAfter18 })
        : getOasIncomeAtAge(OAS_MAX_ANNUAL_2026, p.oasStartAge, age)
      const maxStart = v2 ? maxPensionStartAge(p.province) : undefined
      let cppReal = getCppIncomeAtAge(p.cppAt65, p.cppStartAge, age, maxStart)
      // CPP survivor's pension from a deceased spouse.
      if (v2 && live && peopleCount === 2 && !alive[1 - i]) {
        const deceased = c.people[1 - i]
        cppReal += cppSurvivorBenefit({
          deceasedPension: deceased.cppAt65,
          survivorOwnPension: p.cppAt65,
          survivorAge: age,
          ownPensionPayable: cppReal > 0,
          plan: p.province === 'QC' ? 'qpp' : 'cpp',
          survivorOwnPensionPaid: cppReal,
          survivorStartAge: p.cppStartAge,
        })
      }
      return {
        age,
        alive: alive[i],
        employment: (income.employment[t] + income.selfEmployment[t]) * live,
        pension: income.pension[t] * live,
        cpp: cppReal * k * live * period,
        oas: oasReal * k * live * period,
        gis: 0,
        otherIncome: v2
          ? (income.otherOrdinary[t] + income.eligibleDividends[t] + income.capitalGains[t] + income.nonTaxable[t] - income.deposited[t]) * live
          : 0,
        registeredWithdrawals: 0,
        minimumWithdrawals: 0,
        stockCompensation: 0,
        pensionSplit: 0,
        taxableIncome: 0,
        federal: 0,
        provincial: 0,
        tax: 0,
        oasClawback: 0,
        payroll: 0,
        rrspRefund: 0,
        investmentIncome: 0,
        realizedGains: 0,
        rrspRoom: NaN,
        tfsaRoom: NaN,
      }
    })

    const row: YearRow = {
      offset: t,
      year: c.startYear + t,
      periodFraction: period,
      cpi: k,
      cpiEnd: k * (1 + (path.inflation[t] ?? 0)),
      phase: t < D ? 'accumulation' : 'drawdown',
      people: peopleYear,
      balancesStart,
      balancesEnd: balancesStart,
      contributions: 0,
      scheduledContributions: 0,
      excessContributions: 0,
      missedContributions: 0,
      growth: 0,
      oneTimeExpenses: 0,
      saleCostsPaid: 0,
      withdrawal: 0,
      withdrawalsByAccount: new Array(accountCount).fill(0),
      taxableWithdrawal: 0,
      taxFreeWithdrawal: 0,
      shortfall: 0,
      fundedSpending: 0,
      budgetShortfall: 0,
      essentialShortfall: 0,
      withdrawalShortfall: 0,
      tax: 0,
      oasClawback: 0,
      gis: 0,
      otherIncome: peopleYear.reduce((s, p) => s + p.otherIncome, 0),
      rrspRefunds: 0,
      investmentIncome: 0,
      realizedGains: 0,
      deposits: 0,
      refundsReinvested: 0,
      homePurchaseWithdrawals: 0,
      propertySaleCredit: 0,
      spending: 0,
      debtPayments: 0,
      surplus: 0,
      propertyValue: 0,
      debtBalance: 0,
      netWorth: 0,
      meltdownWithdrawals: 0,
      reinvested: 0,
      saved: 0,
      stockValue: 0,
      unvestedValue: 0,
      stockSales: 0,
      stockCompensation: 0,
      stockTaxWithheld: 0,
      rsuAwards: [],
      guaranteedIncome: 0,
      grossIncome: 0,
      afterTaxIncome: 0,
    }

    // Split an amount owned by a person (or jointly) among living people.
    const creditOwner = (target: number[], who: number, amount: number) => {
      if (who >= 0 && alive[who]) target[who] += amount
      else if (aliveIdx.length > 0) for (const j of aliveIdx) target[j] += amount / aliveIdx.length
    }
    const credit = (target: number[], a: number, amount: number) => creditOwner(target, owner[a], amount)
    const realized = zeros()
    // Part of `realized` from property sales, which simple mode invests net of tax.
    const saleGains = zeros()

    const deposit = (a: number, amount: number) => {
      if (a < 0 || amount <= 0) return
      balances[a] += amount
      acb[a] += amount
      row.deposits += amount
    }

    // Registered-account rules for this year: RRIF minimums, LIF maximums,
    // locked-in LIRAs. Ages are at January 1 (age reached this year − 1).
    const minimum = new Array(accountCount).fill(0)
    const maximum = new Array(accountCount).fill(Infinity)
    if (v2) {
      for (let a = 0; a < accountCount; a++) {
        const acct = c.accounts[a]
        const o = owner[a]
        if (o < 0 || !['RRSP', 'RRIF', 'LIRA', 'LIF'].includes(acct.type)) continue
        const ageJan1 = peopleYear[o].age - 1
        const spouseAges = aliveIdx.map(j => peopleYear[j].age - 1)
        const minAge = c.rrifUseYoungerSpouseAge ? Math.min(ageJan1, ...spouseAges) : ageJan1
        const retired = t >= c.people[o].retirementOffset
        if (acct.type === 'RRSP' || acct.type === 'RRIF') {
          // No minimum in the year of conversion: it applies from the next January.
          const isRrif = acct.type === 'RRIF' || ageJan1 >= (acct.rrifConversionAge ?? c.rrifConversionAge)
          if (isRrif) minimum[a] = balances[a] * rrifMinimumFactor(minAge)
        } else {
          // LIRAs unlock as a LIF once the owner is 55 and retired (or 71). A
          // LIF's minimum starts the January after the conversion, the first
          // year it pays.
          const unlocked = peopleYear[o].age >= LIF_EARLIEST_AGE && (acct.type === 'LIF' || retired || ageJan1 >= RRIF_LATEST_CONVERSION_AGE)
          if (!unlocked) {
            maximum[a] = 0
          } else {
            minimum[a] = ageJan1 >= RRIF_LATEST_CONVERSION_AGE || acct.type === 'LIF' || liraPaying[a] ? balances[a] * rrifMinimumFactor(minAge) : 0
            // Quebec removed the maximum for holders aged 55 and over in 2025.
            const noMaximum = acct.lockedInJurisdiction === 'QC' && peopleYear[o].age >= LIF_EARLIEST_AGE
            maximum[a] = noMaximum ? Infinity : Math.max(minimum[a], balances[a] * lifMaximumFactor(ageJan1, acct.lockedInJurisdiction))
          }
        }
        minimum[a] *= period
        maximum[a] *= period
        peopleYear[o].minimumWithdrawals += minimum[a]
      }
      // A fixed-amount stock sell plan works like a required withdrawal.
      for (const a of stockAccounts) {
        const sale = c.accounts[a].stock!.sale
        if (sale.kind === 'fixedAmount' && t >= sale.startOffset && t < sale.endOffset) {
          minimum[a] = Math.min(balances[a], sale.amount * k * period)
        }
      }
    }
    // "Cover the gap" sell plans draw stock before any other account.
    const drawFirst = stockAccounts.filter(a => {
      const sale = c.accounts[a].stock!.sale
      return sale.kind === 'coverGap' && t >= sale.startOffset && t < sale.endOffset
    })
    const takenThisYear = new Array(accountCount).fill(0)

    // RRIF and LIF payments are eligible pension income at 65; so is an RRSP
    // from the year it converts. An FHSA or unconverted RRSP withdrawal is not.
    const isPensionIncome = (a: number) => {
      const type = c.accounts[a].type
      if (type === 'RRIF' || type === 'LIF' || type === 'LIRA') return true
      return type === 'RRSP' && owner[a] >= 0 && peopleYear[owner[a]].age >= (c.accounts[a].rrifConversionAge ?? c.rrifConversionAge)
    }

    // Plan a withdrawal without changing balances, so the solver can try
    // amounts; apply it once the amount is settled. Required minimums always
    // come out; the rest follows the withdrawal order (or pro rata).
    // `skipRequiredMinimums` is for a one-time cost: the amount has to be exactly
    // what the cost needs, and the year's minimums still come out afterwards, less
    // whatever this withdrawal already took from those accounts.
    const planWithdrawal = (amount: number, { skipRequiredMinimums = false } = {}): PlannedWithdrawal => {
      const cap = balances.map((b, a) => Math.max(0, Math.min(b, maximum[a] - takenThisYear[a])))
      const taken = cap.map((cp, a) => (skipRequiredMinimums ? 0 : Math.min(cp, Math.max(0, minimum[a] - takenThisYear[a]))))
      let remaining = Math.max(0, amount) - sum(taken)
      const fill = (members: number[]) => {
        const headroom = members.reduce((s, a) => s + (cap[a] - taken[a]), 0)
        if (remaining <= 0 || headroom <= 0) return
        const share = Math.min(1, remaining / headroom)
        for (const a of members) {
          const extra = (cap[a] - taken[a]) * share
          taken[a] += extra
          remaining -= extra
        }
      }
      const all = c.accounts.map((_, a) => a)
      if (drawFirst.length > 0) fill(drawFirst)
      if (c.withdrawalOrder === 'custom') {
        const ranks = [...new Set(c.accounts.map(a => a.orderRank))].sort((x, y) => x - y)
        for (const rank of ranks) fill(all.filter(a => c.accounts[a].orderRank === rank))
      } else {
        fill(all)
      }
      const plan: PlannedWithdrawal = { taken, registered: zeros(), nonEligible: zeros(), gains: zeros(), cutOrdinary: zeros(), cutEligible: zeros() }
      for (let a = 0; a < accountCount; a++) {
        if (taken[a] <= 0) continue
        if (c.accounts[a].taxable) {
          credit(plan.registered, a, taken[a])
          if (!isPensionIncome(a)) credit(plan.nonEligible, a, taken[a])
        }
        if (c.accounts[a].nonRegistered && balances[a] > 0) {
          // Signed: a holding worth less than its cost realizes a loss.
          credit(plan.gains, a, taken[a] * (1 - acb[a] / balances[a]))
          credit(plan.cutOrdinary, a, taken[a] * ordinaryRate[a])
          credit(plan.cutEligible, a, taken[a] * eligibleRate[a])
        }
      }
      return plan
    }
    const applyWithdrawal = (plan: PlannedWithdrawal) => {
      for (let a = 0; a < accountCount; a++) {
        const taken = plan.taken[a]
        if (taken <= 0) continue
        if (c.accounts[a].nonRegistered && balances[a] > 0) acb[a] -= taken * (acb[a] / balances[a])
        balances[a] -= taken
        takenThisYear[a] += taken
        if (c.accounts[a].stock) syncHoldings(a)
      }
      for (let i = 0; i < peopleCount; i++) {
        realized[i] += plan.gains[i]
        invOrdinary[i] -= plan.cutOrdinary[i]
        invEligible[i] -= plan.cutEligible[i]
      }
    }
    const tfsaWithdrawals = zeros()
    const emptyPlan = (): PlannedWithdrawal => ({ taken: new Array(accountCount).fill(0), registered: zeros(), nonEligible: zeros(), gains: zeros(), cutOrdinary: zeros(), cutEligible: zeros() })
    const recordWithdrawal = (plan: PlannedWithdrawal) => {
      const total = sum(plan.taken)
      row.withdrawal += total
      plan.taken.forEach((v, i) => { row.withdrawalsByAccount[i] += v })
      row.taxableWithdrawal += c.accounts.reduce((s, a, i) => s + (a.taxable ? plan.taken[i] : 0), 0)
      row.taxFreeWithdrawal = row.withdrawal - row.taxableWithdrawal
      plan.registered.forEach((v, i) => { peopleYear[i].registeredWithdrawals += v })
      for (const a of stockAccounts) row.stockSales += plan.taken[a]
      c.accounts.forEach((a, i) => {
        if (a.type === 'TFSA' && plan.taken[i] > 0 && owner[i] >= 0) tfsaWithdrawals[owner[i]] += plan.taken[i]
      })
    }
    const mergePlans = (x: PlannedWithdrawal, y: PlannedWithdrawal): PlannedWithdrawal => ({
      taken: x.taken.map((v, i) => v + y.taken[i]),
      registered: x.registered.map((v, i) => v + y.registered[i]),
      nonEligible: x.nonEligible.map((v, i) => v + y.nonEligible[i]),
      gains: x.gains.map((v, i) => v + y.gains[i]),
      cutOrdinary: x.cutOrdinary.map((v, i) => v + y.cutOrdinary[i]),
      cutEligible: x.cutEligible.map((v, i) => v + y.cutEligible[i]),
    })

    // Windfalls are invested at the start of the year. They stop with their
    // original owner: by then the account has rolled over to the survivor.
    const receiptsInvested: { a: number; amount: number }[] = []
    for (let a = 0; a < accountCount; a++) {
      const amount = depositSeries[a][t]
      const from = c.accounts[a].ownerIndex
      if (amount <= 0 || (from >= 0 && !alive[from])) continue
      deposit(a, amount)
      receiptsInvested.push({ a, amount })
    }

    // A qualifying FHSA withdrawal buys the home: tax-free, and out of the plan.
    c.accounts.forEach((acct, a) => {
      if (acct.fhsa?.homePurchaseYear === row.year && balances[a] > 0) {
        row.homePurchaseWithdrawals += balances[a]
        balances[a] = 0
      }
    })

    // RSUs vest and ESPP purchases settle at this year's price. The value is
    // employment income paid in shares, and becomes the cost base. Unvested
    // grants and ESPP stop if the employee has died.
    // ESPP purchases are worked out here and bought once the year's cash is
    // known: nothing is bought with money the household doesn't have.
    const vestedThisYear = zeros()
    let esppCash = 0
    let esppShare = 1
    const esppBenefit = zeros()
    const esppPurchases: { a: number; holding: number; employee: number; contribution: number; fairValue: number; benefit: number }[] = []
    const sellToCover: { a: number; holding: number; employee: number; value: number; award?: RsuAward }[] = []
    for (const a of stockAccounts) {
      const employee = c.accounts[a].ownerIndex
      const employed = v2 && employee >= 0 && alive[employee]
      for (const h of c.accounts[a].stock!.holdings) {
        if (!employed) continue
        const price = holdingPrice[h.index]
        let added = 0
        let benefit = 0
        for (const g of h.grants) {
          if (g.offset === t) {
            added += g.shares * price
            benefit += g.shares * price
            vestedThisYear[employee] += g.shares * price
            if (h.sellToCover && v2) sellToCover.push({ a, holding: h.index, employee, value: g.shares * price })
          } else if (g.offset > t) {
            row.unvestedValue += g.shares * price
          }
        }
        const contribution = h.espp ? esppSeries[h.index][t] : 0
        if (contribution > 0 && h.espp) {
          const fairValue = contribution * (1 + h.espp.match) / (1 - h.espp.discount)
          esppPurchases.push({ a, holding: h.index, employee, contribution, fairValue, benefit: fairValue - contribution })
          esppBenefit[employee] += fairValue - contribution
          esppCash += contribution
        }
        if (added <= 0) continue
        holdingValue[h.index] += added
        balances[a] += added
        acb[a] += added
        peopleYear[employee].stockCompensation += benefit
        row.stockCompensation += benefit
      }
    }
    // Buy this year's ESPP shares, scaled to the share of cash available.
    const settleEspp = (share: number) => {
      for (const p of esppPurchases) {
        const fair = p.fairValue * share
        if (fair <= 0) continue
        holdingValue[p.holding] += fair
        balances[p.a] += fair
        acb[p.a] += fair
        peopleYear[p.employee].stockCompensation += p.benefit * share
        row.stockCompensation += p.benefit * share
      }
      row.contributions += esppCash * share
      esppBenefit.fill(0)
    }

    // RSU bonuses are a dollar value, so a higher projected price means fewer
    // shares for the same award. Taxed like any other vest.
    for (const bonus of rsuBonuses) {
      const value = bonus.series[t]
      if (value <= 0 || !alive[bonus.employee]) continue
      const { account: a, holding, employee } = bonus
      if (holding >= 0) holdingValue[holding] += value
      balances[a] += value
      acb[a] += value
      peopleYear[employee].stockCompensation += value
      row.stockCompensation += value
      const price = holding >= 0 ? holdingPrice[holding] : 0
      const award: RsuAward | undefined = price > 0
        ? { incomeId: bonus.incomeId, value, price, shares: value / price, sharesKept: value / price }
        : undefined
      if (award) row.rsuAwards.push(award)
      if (bonus.sellToCover) sellToCover.push({ a, holding, employee, value, award })
    }

    // Property sales happen at the start of the year: repay the mortgage,
    // buy any replacement home, invest the rest. When the proceeds fall short,
    // the portfolio is asked for the difference once tax can be worked out
    // below; whatever it cannot cover stays owing.
    const salesToFund: { property: number; replacement: number; debts: { index: number; amount: number }[]; debtGap: number; homeGap: number }[] = []
    c.properties.forEach((prop, p) => {
      if (prop.saleOffset !== t || !propertyOwned[p]) return
      const gross = propertyValue[p]
      const costs = gross * prop.sellingCost
      const debts = c.debts.flatMap((d, j) => (d.propertyIndex === p && debtBalance[j] > 0 ? [{ index: j, amount: debtBalance[j] }] : []))
      const owed = sum(debts.map(d => d.amount))
      debts.forEach(d => { debtBalance[d.index] = 0 })
      const gain = prop.principalResidence ? 0 : Math.max(0, gross - costs - propertyAcb[p])
      creditOwner(realized, propertyOwner[p], gain)
      creditOwner(saleGains, propertyOwner[p], gain)
      const replacement = prop.replacementValue * k
      const proceeds = gross - costs
      const toDebt = Math.min(proceeds, owed)
      const toHome = Math.min(proceeds - toDebt, replacement)
      const invested = proceeds - toDebt - toHome
      deposit(prop.proceedsAccount, invested)
      if (invested > 0 && prop.proceedsAccount >= 0) receiptsInvested.push({ a: prop.proceedsAccount, amount: invested })
      if (prop.proceedsAccount >= 0) row.propertySaleCredit += Math.max(0, invested - gain)
      if (owed > toDebt || replacement > toHome) {
        salesToFund.push({ property: p, replacement, debts, debtGap: owed - toDebt, homeGap: replacement - toHome })
      }
      if (replacement > 0) {
        propertyValue[p] = replacement
        propertyAcb[p] = replacement
      } else {
        propertyOwned[p] = false
        propertyValue[p] = 0
      }
    })

    // Taxable distributions from non-registered and cash accounts, reinvested
    // (they raise the cost base). They are part of the account's return, and
    // earned only on what stays invested: `plan.cut*` takes off the part of a
    // withdrawal's balance that no longer earns them.
    const invOrdinary = zeros()
    const invEligible = zeros()
    const ordinaryRate = new Array(accountCount).fill(0)
    const eligibleRate = new Array(accountCount).fill(0)
    for (let a = 0; a < accountCount; a++) {
      const acct = c.accounts[a]
      if (!acct.nonRegistered || balances[a] <= 0) continue
      const y = acct.yields
      // The account's return is already for the period; yields are per year.
      ordinaryRate[a] = acct.interestOnly ? Math.max(0, accountReturn[a]) + y.foreignDividends * period : (y.interest + y.foreignDividends) * period
      eligibleRate[a] = y.eligibleDividends * period
      // Stock dividends are reinvested and taxed each year.
      if (v2 && acct.stock) {
        for (const h of acct.stock.holdings) {
          const dividend = holdingValue[h.index] * h.dividendYield * period
          if (h.dividendEligible) eligibleRate[a] += dividend / balances[a]
          else ordinaryRate[a] += dividend / balances[a]
        }
      }
      credit(invOrdinary, a, ordinaryRate[a] * balances[a])
      credit(invEligible, a, eligibleRate[a] * balances[a])
    }
    // Reinvested distributions raise the cost base of what is still invested.
    const accrueDistributions = () => {
      for (let a = 0; a < accountCount; a++) {
        if (c.accounts[a].nonRegistered && !c.accounts[a].interestOnly) acb[a] += balances[a] * (ordinaryRate[a] + eligibleRate[a])
      }
    }

    // Debt payments for the year.
    const debtMonths = Math.round(period * 12)
    const debtSteps = c.debts.map((d, j) => {
      const opening = debtBalance[j]
      if (opening <= 0) return null
      const step = amortizeYear(opening, d.annualRate, d.monthlyPayment, d.rateCompounding, debtMonths)
      debtBalance[j] = step.balance
      row.debtPayments += step.paid
      return { opening, step }
    })

    // Spending need for the year.
    let essentialNeed = 0
    // Only once a couple has become one person.
    const survivorScale = v2 && peopleCount === 2 && aliveIdx.length === 1 ? c.survivorSpending : 1
    if (detailed) {
      const propertyCosts = c.properties.reduce((s, prop, p) => s + (propertyOwned[p] ? prop.annualCosts * k * period : 0), 0)
      essentialNeed = essentialSpending[t] * survivorScale + oneTimeEssential[t] + propertyCosts + row.debtPayments
      row.spending = essentialNeed + (discretionarySpending[t] * survivorScale + oneTimeDiscretionary[t]) * phaseMultiplier[t]
    } else if (t >= D) {
      row.spending = c.simpleSpendingTarget * k * period * survivorScale
    }

    // Real-dollar tax inputs for each living person (v2 only).
    // `registered` is the candidate on top of any one-time withdrawals already made.
    const oneOff = { registered: zeros(), nonEligible: zeros(), taken: 0, paid: 0, shortfall: 0 }
    // Set while working out how much tax the year's receipts add.
    let withoutReceipts = false
    // `pending` is a withdrawal being tried but not yet applied.
    const taxInputs = (registered: number[], rrspDeduction: number[], extraGains?: number[], nonEligible?: number[], pending?: PlannedWithdrawal): TaxMember[] =>
      aliveIdx.map(i => {
        const income = incomeByPerson[i]
        const p = c.people[i]
        const less = (bucket: ReceiptBucket) => (withoutReceipts ? income.receipts[bucket][t] : 0)
        const receipt = (bucket: ReceiptBucket) => (withoutReceipts ? 0 : income.receipts[bucket][t])
        return {
          oneTime: period < 1 ? {
            employment: (receipt('employment') + vestedThisYear[i]) / k,
            selfEmployment: receipt('selfEmployment') / k,
            pension: receipt('pension') / k,
            registered: oneOff.registered[i] / k,
            nonEligible: oneOff.nonEligible[i] / k,
            otherOrdinary: receipt('otherOrdinary') / k,
            eligibleDividends: receipt('eligibleDividends') / k,
            capitalGains: (receipt('capitalGains') + (withoutReceipts ? 0 : saleGains[i])) / k,
          } : undefined,
          province: p.province,
          age: peopleYear[i].age,
          employment: (income.employment[t] - less('employment') + peopleYear[i].stockCompensation + esppBenefit[i] * esppShare) / k,
          selfEmployment: (income.selfEmployment[t] - less('selfEmployment')) / k,
          pension: (peopleYear[i].pension - less('pension')) / k,
          registeredWithdrawals: (registered[i] + oneOff.registered[i]) / k,
          nonEligibleRegistered: ((nonEligible?.[i] ?? 0) + oneOff.nonEligible[i]) / k,
          cpp: peopleYear[i].cpp / k,
          oas: peopleYear[i].oas / k,
          otherOrdinary: (income.otherOrdinary[t] - less('otherOrdinary') + invOrdinary[i] - (pending?.cutOrdinary[i] ?? 0)) / k,
          eligibleDividends: (income.eligibleDividends[t] - less('eligibleDividends') + invEligible[i] - (pending?.cutEligible[i] ?? 0)) / k,
          // Net of the year's losses and of losses carried forward.
          capitalGains: Math.max(0, income.capitalGains[t] - less('capitalGains') + realized[i] - (withoutReceipts ? saleGains[i] : 0) + (extraGains?.[i] ?? 0) - lossCarry[i]) / k,
          rrspDeduction: rrspDeduction[i] / k,
        }
      })
    const yearRealValues: Partial<Record<ProvinceCode, RealValues>> = {}
    for (const [province, values] of realValuesByProvince) yearRealValues[province] = values[t]
    const taxOpts = { deflator: 1 / k, splitting: c.pensionSplitting, realValues: yearRealValues }
    // Tax is annual, but a partial first year is only part of one. With R the
    // annualized recurring income and O the year's one-time items, the tax left
    // to pay is T(R+O) − (1−f)·T(R): the year so far is assumed to have run at
    // the same steady pace and already paid its share.
    const householdTax = (inputs: TaxMember[]): HouseholdTaxResult => {
      if (period >= 1) return computeHouseholdTax(inputs, taxOpts)
      const full = computeHouseholdTax(inputs.map(m => annualizedMember(m, period, true)), taxOpts)
      const recurring = computeHouseholdTax(inputs.map(m => annualizedMember(m, period, false)), taxOpts)
      const remaining = (whole: number, part: number) => whole - (1 - period) * part
      return {
        splits: full.splits,
        quebecSplits: full.quebecSplits,
        total: remaining(full.total, recurring.total),
        perPerson: full.perPerson.map((res, m) => {
          const rec = recurring.perPerson[m]
          return {
            ...res,
            netIncome: remaining(res.netIncome, rec.netIncome),
            taxableIncome: remaining(res.taxableIncome, rec.taxableIncome),
            federal: remaining(res.federal, rec.federal),
            provincial: remaining(res.provincial, rec.provincial),
            oasClawback: remaining(res.oasClawback, rec.oasClawback),
            total: remaining(res.total, rec.total),
            payroll: { ...res.payroll, total: remaining(res.payroll.total, rec.payroll.total) },
          }
        }),
      }
    }
    // GIS is an annual formula too; the period's share of it is paid.
    // Benefits are set on last year's income, except that a drop in employment
    // or pension income can be reported as an estimate of this year's.
    const widowed = peopleCount === 2 && aliveIdx.length === 1
    const gisFor = (inputs: TaxMember[]) => gisAnnual(inputs.map((partial, m) => {
      const i = aliveIdx[m]
      const current = gisIncomeOf(period < 1 ? annualizedMember(partial, period, true) : partial)
      const last = priorGisIncome[i]
      const base = last
        ? { employment: Math.min(current.employment, last.employment), pension: Math.min(current.pension, last.pension), other: last.other }
        : current
      return {
        receivesOas: partial.oas > 0,
        employmentIncome: base.employment,
        otherIncome: base.pension + base.other,
        age: partial.age,
        residencyYears: c.people[i].yearsInCanadaAfter18,
        widowed,
      }
    })).map(amount => amount * period)

    const recordTax = (household: HouseholdTaxResult) => {
      household.perPerson.forEach((res, m) => {
        const p = peopleYear[aliveIdx[m]]
        p.pensionSplit = household.splits[m] * k
        p.taxableIncome = res.taxableIncome * k
        p.federal = res.federal * k
        p.provincial = res.provincial * k
        p.oasClawback = res.oasClawback * k
        p.tax = res.total * k
        p.payroll = res.payroll.total * k
      })
      row.tax = household.total * k
      row.oasClawback = household.perPerson.reduce((s, res) => s + res.oasClawback, 0) * k
    }
    const recordGis = (inputs: TaxMember[]) => {
      const gis = gisFor(inputs)
      gis.forEach((g, m) => { peopleYear[aliveIdx[m]].gis = g * k })
      row.gis = sum(gis) * k
    }
    const payrollTotal = () => peopleYear.reduce((s, p) => s + p.payroll, 0)
    const guaranteedBeforeGis = () => peopleYear.reduce((s, p) => s + p.pension + p.cpp + p.oas, 0)
    const noDeduction = zeros()

    const employmentTotal = () => peopleYear.reduce((s, p) => s + p.employment, 0)
    // Withdrawn for a one-time cost beyond what the cost took: it pays that
    // withdrawal's own tax, which is already part of the year's tax.
    const oneOffCash = () => oneOff.taken - oneOff.paid

    // After-tax cash for a planned withdrawal (v2), including GIS. Everything
    // is read from this candidate, so it holds before anything is committed.
    const afterTaxCash = (planned: PlannedWithdrawal, deduction = noDeduction) => {
      const inputs = taxInputs(planned.registered, deduction, planned.gains, planned.nonEligible, planned)
      const household = householdTax(inputs)
      const payroll = household.perPerson.reduce((s, res) => s + res.payroll.total, 0) * k
      const gis = sum(gisFor(inputs)) * k
      return guaranteedBeforeGis() + gis + row.otherIncome + sum(planned.taken) + employmentTotal() +
        oneOffCash() - household.total * k - payroll + withheld
    }

    const contributedTo = { rrsp: zeros(), tfsa: zeros() }

    // TFSA room available now. When the person doesn't track room, assume only
    // this year's new room and last year's withdrawals are free.
    const tfsaAllowance = (i: number) => {
      const fresh = LIMITS.tfsaAnnual * k + priorTfsaWithdrawals[i]
      const room = Number.isNaN(tfsaRoom[i])
        ? fresh
        : tfsaRoom[i] + (t > 0 && peopleYear[i].age >= 18 ? fresh : 0)
      return Math.max(0, room - contributedTo.tfsa[i])
    }

    // Reinvest cash that was withdrawn but not needed (forced minimums,
    // meltdown) into the owner's TFSA as far as room allows, else non-registered.
    const reinvest = (amount: number, preferTfsaOf = -1) => {
      if (amount <= 0) return
      let remaining = amount
      const tfsa = preferTfsaOf >= 0 ? c.accounts.findIndex((a, i) => a.type === 'TFSA' && owner[i] === preferTfsaOf) : -1
      if (tfsa >= 0) {
        const toTfsa = Math.min(remaining, tfsaAllowance(preferTfsaOf))
        if (toTfsa > 0) {
          deposit(tfsa, toTfsa)
          contributedTo.tfsa[preferTfsaOf] += toTfsa
          row.reinvested += toTfsa
          remaining -= toTfsa
        }
      }
      if (remaining > 0 && c.reinvestAccount >= 0) {
        deposit(c.reinvestAccount, remaining)
        row.reinvested += remaining
      }
    }

    // Pay a one-time cost from the portfolio, grossed up for the tax it
    // causes. Returns how much of `need` could be paid.
    const fundOneOff = (need: number): number => {
      if (need <= 0) return 0
      const baseTax = householdTax(taxInputs(zeros(), noDeduction)).total * k
      const net = (plan: PlannedWithdrawal) =>
        sum(plan.taken) - (householdTax(taxInputs(plan.registered, noDeduction, plan.gains, plan.nonEligible, plan)).total * k - baseTax)
      const onlyThisCost = { skipRequiredMinimums: true }
      const w = solveIncreasing(x => net(planWithdrawal(x, onlyThisCost)) - need, 0, sum(balances))
      const plan = planWithdrawal(w, onlyThisCost)
      const paid = Math.max(0, Math.min(need, net(plan)))
      applyWithdrawal(plan)
      recordWithdrawal(plan)
      plan.registered.forEach((v, i) => { oneOff.registered[i] += v })
      plan.nonEligible.forEach((v, i) => { oneOff.nonEligible[i] += v })
      oneOff.taken += sum(plan.taken)
      oneOff.paid += paid
      return paid
    }

    // Sell to cover: part of the shares vesting this year is sold at once to
    // pay the income tax and payroll deductions they add. Those are the shares
    // just received (cost = price), so the sale has no capital gain: ITA 7(1.31)
    // lets shares sold within 30 days be designated as the new ones instead of
    // averaging them with shares already held. It needs the designation on the
    // return and no other trades in those shares in between. The tax still
    // counts in the year's tax; it is paid by the shares, not from cash.
    let withheld = 0
    if (sellToCover.length > 0) {
      const payroll = (h: HouseholdTaxResult) => h.perPerson.reduce((s, r) => s + r.payroll.total, 0)
      const full = householdTax(taxInputs(zeros(), zeros()))
      for (const employee of new Set(sellToCover.map(v => v.employee))) {
        const m = aliveIdx.indexOf(employee)
        if (m < 0) continue
        const vests = sellToCover.filter(v => v.employee === employee)
        const value = sum(vests.map(v => v.value))
        const inputs = taxInputs(zeros(), zeros())
        inputs[m] = { ...inputs[m], employment: inputs[m].employment - value / k }
        const without = householdTax(inputs)
        const due = Math.min(value, Math.max(0, (full.total + payroll(full) - without.total - payroll(without)) * k))
        for (const v of vests) {
          const sold = due * (v.value / value)
          if (v.holding >= 0) holdingValue[v.holding] -= sold
          balances[v.a] -= sold
          acb[v.a] -= sold
          if (v.award) v.award.sharesKept -= sold / v.award.price
        }
        withheld += due
      }
      row.stockTaxWithheld = withheld
    }

    // Settle property sales the proceeds did not cover: the debt comes first.
    for (const sale of salesToFund) {
      const paid = fundOneOff(sale.debtGap + sale.homeGap)
      row.saleCostsPaid += paid
      const toDebt = Math.min(paid, sale.debtGap)
      const debtLeft = sale.debtGap - toDebt
      const owed = sum(sale.debts.map(d => d.amount))
      sale.debts.forEach(d => { debtBalance[d.index] += debtLeft * (d.amount / owed) })
      const homeLeft = sale.homeGap - (paid - toDebt)
      if (homeLeft > 0.5) {
        const value = sale.replacement - homeLeft
        propertyValue[sale.property] = Math.max(0, value)
        propertyAcb[sale.property] = Math.max(0, value)
        if (value <= 0) propertyOwned[sale.property] = false
      }
      oneOff.shortfall += debtLeft + homeLeft
    }

    // Simple-mode gifts come out on their own date (v2).
    if (v2 && oneTimePot[t] > 0) {
      const paid = fundOneOff(oneTimePot[t])
      row.oneTimeExpenses = paid
      oneOff.shortfall += oneTimePot[t] - paid
    }

    // Contribution schedules run on their own dates, whichever phase the
    // household is in, and stop when the person who makes them dies. `owner`
    // can't tell: by then the account has rolled over to the survivor.
    // New RRSP room arrives each January, from last year's earnings less any
    // pension adjustment. Without a real room figure, the first year uses this
    // year's earnings as the estimate of last year's.
    if (v2) {
      c.people.forEach((p, i) => {
        const untrackedFirstYear = t === 0 && p.rrspRoom === undefined
        if (t === 0 && !untrackedFirstYear) return
        // Room comes from a full year's earnings, so a partial year is annualized.
        const earnings = untrackedFirstYear
          ? (incomeByPerson[i].employment[0] + incomeByPerson[i].selfEmployment[0]) / firstPeriod
          : (incomeByPerson[i].employment[t - 1] + incomeByPerson[i].selfEmployment[t - 1] + rows[t - 1].people[i].stockCompensation) / rows[t - 1].periodFraction
        if (earnings <= 0) return
        rrspRoom[i] += Math.max(0, Math.min(LIMITS.rrspRate * earnings, LIMITS.rrspMax * k) - p.pensionAdjustment * k)
      })
    }

    const fhsaYearLeft = fhsaYearRoom.slice()
    const fhsaLifetimeLeft = fhsaLifetime.slice()
    const contributions = c.accounts.map((acct, a) => {
      let amount = contributionSeries[a][t]
      if (acct.ownerIndex >= 0 && !alive[acct.ownerIndex]) amount = 0
      if (acct.type === 'FHSA') {
        const i = acct.ownerIndex
        if (acct.openedYear !== undefined && c.startYear + t < acct.openedYear) amount = 0
        if (acct.fhsa && (row.year > acct.fhsa.closureYear || (acct.fhsa.homePurchaseYear !== undefined && row.year >= acct.fhsa.homePurchaseYear))) amount = 0
        amount = Math.min(amount, i >= 0 ? Math.min(fhsaYearLeft[i], fhsaLifetimeLeft[i]) : LIMITS.fhsaAnnual)
        if (i >= 0) {
          fhsaYearLeft[i] -= amount
          fhsaLifetimeLeft[i] -= amount
        }
      }
      return amount
    })
    // Room is only used by money that actually goes in.
    const useFhsaRoom = (amounts: number[]) => c.accounts.forEach((acct, a) => {
      const i = acct.ownerIndex
      if (acct.type !== 'FHSA' || i < 0) return
      fhsaYearRoom[i] -= amounts[a]
      fhsaLifetime[i] -= amounts[a]
    })
    const countTowardRoom = (amounts: number[]) => c.accounts.forEach((acct, a) => {
      if (owner[a] < 0) return
      if (acct.type === 'RRSP') contributedTo.rrsp[owner[a]] += amounts[a]
      if (acct.type === 'TFSA') contributedTo.tfsa[owner[a]] += amounts[a]
    })
    const deductionsFor = (amounts: number[]) => {
      const deductible = zeros()
      c.accounts.forEach((a, i) => { if (a.deductible && owner[i] >= 0) deductible[owner[i]] += amounts[i] })
      return deductible
    }
    const scheduledSaving = sum(contributions) + esppCash
    row.scheduledContributions = scheduledSaving

    // Contributions over RRSP room, or over tracked TFSA room, can't be sheltered:
    // the excess goes to the owner's non-registered account instead, undeducted.
    let excessTotal = 0
    if (v2) {
      const rrspLeft = rrspRoom.map(room => Math.max(0, room))
      const tfsaLeft = c.people.map((_, i) => (Number.isNaN(tfsaRoom[i]) ? Infinity : tfsaAllowance(i)))
      const redirected = new Array(accountCount).fill(0)
      c.accounts.forEach((acct, a) => {
        const i = acct.ownerIndex
        if (i < 0 || contributions[a] <= 0 || acct.excessAccount < 0) return
        const left = acct.type === 'RRSP' ? rrspLeft : acct.type === 'TFSA' ? tfsaLeft : null
        if (!left) return
        const inRoom = Math.min(contributions[a], left[i])
        left[i] -= inRoom
        redirected[acct.excessAccount] += contributions[a] - inRoom
        excessTotal += contributions[a] - inRoom
        contributions[a] = inRoom
      })
      redirected.forEach((amount, a) => { contributions[a] += amount })
    }

    // The largest share of the year's scheduled saving that cash can pay for.
    // `cashAt` is the cash left at a given share. The deduction feeds back into
    // tax, so the answer is solved for; in dollars because the solver's stopping
    // width is absolute.
    const fundedSavingShare = (cashAt: (share: number) => number): number => {
      if (scheduledSaving <= 0 || cashAt(1) >= 0) return 1
      if (cashAt(0) <= 0) return 0
      const cut = solveIncreasing(x => cashAt(1 - x / scheduledSaving), 0, scheduledSaving, 0.01)
      return Math.max(0, 1 - cut / scheduledSaving)
    }

    // Simple mode only: receipts are invested net of the year's combined tax on
    // them, so a taxable sale leaves less than an exempt one. Detailed mode pays
    // that tax through the year's cash instead. `receiptTaxWithheld` is added back
    // to after-tax income, as `withheld` is: the proceeds paid it, not spending.
    // Called once before the year's withdrawal so it is sized on the right
    // balance, and again when the final tax is known.
    let receiptTaxWithheld = 0
    const settleReceiptTax = (registered: number[], nonEligible: number[], deduction: number[]) => {
      if (!v2 || detailed || receiptsInvested.length === 0) return
      const taxAndPayroll = (h: HouseholdTaxResult) => h.total + h.perPerson.reduce((s, r) => s + r.payroll.total, 0)
      const actual = taxAndPayroll(householdTax(taxInputs(registered, deduction, undefined, nonEligible)))
      withoutReceipts = true
      const baseline = taxAndPayroll(householdTax(taxInputs(registered, deduction, undefined, nonEligible)))
      withoutReceipts = false
      const invested = sum(receiptsInvested.map(r => r.amount))
      const due = Math.min(invested, Math.max(0, (actual - baseline) * k))
      const change = due - receiptTaxWithheld
      if (Math.abs(change) < 0.01) return
      for (const { a, amount } of receiptsInvested) {
        const part = change * (amount / invested)
        const applied = Math.min(part, balances[a])
        balances[a] -= applied
        acb[a] -= applied
        row.deposits -= applied
        receiptTaxWithheld += applied
      }
    }

    let toSave = 0
    let yearReturn = { registered: zeros(), nonEligible: zeros(), deduction: noDeduction }
    let contributionsAtYearEnd: number[] | null = null

    if (t < D) {
      let otherRegistered = emptyPlan()
      let yearDeduction = noDeduction

      if (v2) {
        settleReceiptTax(zeros(), zeros(), noDeduction)
        const tfsaRoomBefore = c.people.map((_, i) => tfsaAllowance(i))
        // Required RRIF/LIF minimums of anyone already retired come out even
        // while others still work; the after-tax amount is reinvested.
        const forced = planWithdrawal(0)
        const forcedTaken = sum(forced.taken)
        const earned = peopleYear.reduce((s, p) => s + p.employment + p.pension + p.cpp + p.oas, 0)

        const savingAt = (share: number) => {
          esppShare = share
          const amounts = contributions.map(amount => amount * share)
          const deductible = deductionsFor(amounts)
          const tfsaPaid = zeros()
          c.accounts.forEach((a, i) => { if (a.type === 'TFSA' && owner[i] >= 0) tfsaPaid[owner[i]] += amounts[i] })
          const withDeduction = householdTax(taxInputs(zeros(), deductible))
          // The refund is the tax this person's deductions save this year. It
          // goes to the TFSA as far as room allows.
          const refunds = zeros()
          const refundsToTfsa = zeros()
          let overflow = 0
          c.refundTargets.forEach((target, i) => {
            if (target < 0 || deductible[i] <= 0) return
            const without = householdTax(taxInputs(zeros(), deductible.map((v, j) => (j === i ? 0 : v))))
            refunds[i] = Math.max(0, without.total - withDeduction.total) * k
            refundsToTfsa[i] = Math.min(refunds[i], Math.max(0, tfsaRoomBefore[i] - tfsaPaid[i]))
            overflow += refunds[i] - refundsToTfsa[i]
          })
          const household = forcedTaken > 0
            ? householdTax(taxInputs(forced.registered, deductible, forced.gains, forced.nonEligible, forced))
            : withDeduction
          const gis = sum(gisFor(taxInputs(forced.registered, deductible, undefined, forced.nonEligible, forced))) * k
          const payroll = household.perPerson.reduce((s, res) => s + res.payroll.total, 0) * k
          const saved = sum(amounts) + sum(refundsToTfsa) + overflow + esppCash * share
          const cash = earned + row.otherIncome + gis + forcedTaken + oneOffCash() + withheld - household.total * k - payroll - saved - row.spending
          return { amounts, deductible, withDeduction, household, gis, refunds, refundsToTfsa, overflow, cash }
        }

        // Detailed mode saves only from cash left after tax and spending. Simple
        // mode has no budget to measure that against: its saving comes from
        // outside the model.
        const share = detailed ? fundedSavingShare(s => savingAt(s).cash) : 1
        const year = savingAt(share)
        yearDeduction = year.deductible
        const baseGis = year.gis
        contributions.forEach((_, a) => { contributions[a] = year.amounts[a] })
        useFhsaRoom(contributions)
        countTowardRoom(contributions)
        row.missedContributions = scheduledSaving * (1 - share)
        row.excessContributions = excessTotal * share
        recordTax(year.withDeduction)
        c.refundTargets.forEach((target, i) => {
          if (target < 0 || year.refunds[i] <= 0) return
          peopleYear[i].rrspRefund = year.refunds[i]
          row.rrspRefunds += year.refunds[i]
          contributions[target] += year.refundsToTfsa[i]
          contributedTo.tfsa[i] += year.refundsToTfsa[i]
          if (year.refunds[i] > year.refundsToTfsa[i]) deposit(c.reinvestAccount, year.refunds[i] - year.refundsToTfsa[i])
        })
        row.refundsReinvested = year.overflow

        if (forcedTaken > 0) {
          recordTax(year.household)
          applyWithdrawal(forced)
          recordWithdrawal(forced)
          otherRegistered = forced
          if (!detailed) reinvest(forcedTaken - (year.household.total - year.withDeduction.total) * k)
        }

        if (detailed) {
          // Working-year cash flow: earnings, benefits and withdrawals, less
          // tax, payroll, contributions and spending.
          // A partly funded year is solved to the cent, so what is left is noise.
          const cashWithoutExtra = share < 1 && Math.abs(year.cash) < 0.02 ? 0 : year.cash
          row.surplus = cashWithoutExtra
          if (cashWithoutExtra >= 0) {
            if (c.savingsAccount >= 0) toSave = cashWithoutExtra
            else if (forcedTaken > 0) reinvest(Math.min(cashWithoutExtra, forcedTaken))
          } else {
            // Draw the shortfall from savings, grossed up for the tax it
            // causes. The residual is measured on the proposed withdrawal,
            // before it changes the balances the solver reads.
            const baseTax = row.tax
            const onTopOf = (planned: PlannedWithdrawal) => {
              const merged = mergePlans(otherRegistered, planned)
              return taxInputs(merged.registered, yearDeduction, planned.gains, merged.nonEligible, planned)
            }
            const cashAfter = (w: number) => {
              const planned = planWithdrawal(w)
              const inputs = onTopOf(planned)
              return cashWithoutExtra + sum(planned.taken) - (householdTax(inputs).total * k - baseTax) + (sum(gisFor(inputs)) * k - baseGis)
            }
            const w = solveIncreasing(cashAfter, 0, sum(balances))
            const planned = planWithdrawal(w)
            const residual = cashAfter(w)
            recordTax(householdTax(onTopOf(planned)))
            applyWithdrawal(planned)
            recordWithdrawal(planned)
            otherRegistered = mergePlans(otherRegistered, planned)
            row.shortfall = Math.max(0, -residual)
            row.budgetShortfall = row.shortfall
            row.essentialShortfall = Math.max(0, row.shortfall - (row.spending - essentialNeed))
          }
          row.fundedSpending = Math.max(0, row.spending - row.budgetShortfall)
        }
        settleReceiptTax(otherRegistered.registered, otherRegistered.nonEligible, yearDeduction)
        recordGis(taxInputs(otherRegistered.registered, yearDeduction, undefined, otherRegistered.nonEligible))
        accrueDistributions()
        settleEspp(esppShare)
        yearReturn = { registered: otherRegistered.registered, nonEligible: otherRegistered.nonEligible, deduction: yearDeduction }
      } else {
        countTowardRoom(contributions)
        useFhsaRoom(contributions)
      }

      for (let a = 0; a < accountCount; a++) {
        const acct = c.accounts[a]
        row.contributions += contributions[a]
        if (acct.nonRegistered) acb[a] += contributions[a]
        const balanceBefore = balances[a] + contributions[a]
        if (acct.stock) {
          // Stock purchases are added at the start of the year, pro rata.
          balances[a] += contributions[a]
          syncHoldings(a)
          growStock(a, t)
        } else {
          // v2: the rate that compounds to this year's annual return.
          const monthly = v2 ? Math.pow(1 + accountReturn[a], 1 / 12) - 1 : accountReturn[a] / 12
          balances[a] = calculateFutureValue(balances[a], contributions[a] / 12, monthly, 12)
        }
        row.growth += balances[a] - balanceBefore
      }

      row.guaranteedIncome = peopleYear.reduce((s, p) => s + p.pension + p.cpp + p.oas + p.gis, 0)
      const employment = peopleYear.reduce((s, p) => s + p.employment, 0)
      row.grossIncome = row.guaranteedIncome + row.otherIncome + employment + row.withdrawal - oneOff.paid - row.reinvested
      row.afterTaxIncome = Math.max(0, row.grossIncome - row.tax - payrollTotal() + withheld + receiptTaxWithheld)
    } else {
      // Spending comes first; any ESPP is bought from what is left at the end.
      esppShare = 0
      settleReceiptTax(zeros(), zeros(), noDeduction)

      // The first-year withdrawal is set from the whole portfolio, before
      // any reserved one-time pot comes out (as in the original engine).
      if (t === D) strategy.initialWithdrawal = (sum(balances) / k) * strategy.initialRate

      // v1 only: the reserved one-time pot comes out first, pro rata.
      if (!v2 && oneTimePot[t] > 0) {
        const pot = planWithdrawal(Math.min(sum(balances), oneTimePot[t]))
        applyWithdrawal(pot)
        row.oneTimeExpenses = sum(pot.taken)
      }

      const available = sum(balances)
      const taxableBalance = c.accounts.reduce((s, a, i) => s + (a.taxable ? balances[i] : 0), 0)

      // Withdrawal target for the year (the strategy's amount, nominal).
      let target: number
      let solvedExactly = false
      if (c.strategy === 'expenses' && v2 && detailed) {
        target = solveIncreasing(w => afterTaxCash(planWithdrawal(w)) - row.spending, 0, Math.max(available, 1))
        // When RRIF/LIF minimums alone cover the year the solver stops at 0.
        // They still pay for spending; only what is left over is reinvested,
        // as surplus below.
        target = Math.max(target, sum(planWithdrawal(target).taken))
        solvedExactly = true
      } else if (c.strategy === 'expenses' && v2) {
        // Simple mode: the target is a pre-tax income, so no tax gross-up, but
        // GIS still depends on how much taxable income is withdrawn.
        const grossCash = (w: number) => {
          const planned = planWithdrawal(w)
          const gis = sum(gisFor(taxInputs(planned.registered, noDeduction, planned.gains, undefined, planned))) * k
          return guaranteedBeforeGis() + gis + row.otherIncome + employmentTotal() + sum(planned.taken)
        }
        target = solveIncreasing(w => grossCash(w) - row.spending, 0, Math.max(available, 1))
        // When RRIF/LIF minimums alone cover the target the solver stops at 0.
        // Only the part of the minimums beyond the target is excess.
        if (target === 0) {
          target = Math.max(0, sum(planWithdrawal(0).taken) - Math.max(0, grossCash(0) - row.spending))
        }
        // The solver stops at what is available; record the real gap.
        const unfunded = row.spending - grossCash(Math.min(target, available))
        if (unfunded > 0.5) {
          row.shortfall = unfunded
          solvedExactly = true
        }
      } else {
        const real = strategyWithdrawal(c.spendingStrategy, strategy, {
          portfolio: available / k,
          yearsRemaining: years - t,
          expectedRealReturn: c.expectedRealReturn,
          firstYear: t === D,
        })
        target = real * k * period
        // Flexible strategies never cut below essential spending.
        if (v2 && detailed && c.spendingStrategy.kind !== 'initialPct' && essentialNeed > 0) {
          const floor = solveIncreasing(w => afterTaxCash(planWithdrawal(w)) - essentialNeed, 0, Math.max(available, 1))
          target = Math.max(target, floor)
        }
      }

      let planned = planWithdrawal(Math.min(available, target))
      const forcedExcess = Math.max(0, sum(planned.taken) - target)

      // RRSP meltdown: top each person's taxable income up to the target with
      // extra RRSP/RRIF withdrawals and reinvest what is left after tax.
      let meltdownPlan: PlannedWithdrawal | null = null
      if (v2 && c.meltdown.enabled) {
        const inputs = taxInputs(planned.registered, noDeduction, planned.gains, planned.nonEligible, planned)
        const household = householdTax(inputs)
        const extra = zeros()
        aliveIdx.forEach((i, m) => {
          const room = c.meltdown.targetTaxableIncome * k * period - household.perPerson[m].taxableIncome * k
          if (room > 1) extra[i] = room
        })
        if (sum(extra) > 0) {
          const mergedTaken = planned.taken.slice()
          const extraPlan: PlannedWithdrawal = { ...emptyPlan() }
          aliveIdx.forEach(i => {
            if (extra[i] <= 0) return
            const mine = (a: number) => c.accounts[a].taxable && owner[a] === i && (c.accounts[a].type === 'RRSP' || c.accounts[a].type === 'RRIF')
            const capLeft = c.accounts.map((_, a) => (mine(a) ? Math.max(0, balances[a] - mergedTaken[a]) : 0))
            const headroom = sum(capLeft)
            const take = Math.min(extra[i], headroom)
            if (take <= 0) return
            capLeft.forEach((cap, a) => {
              const amount = headroom > 0 ? (cap / headroom) * take : 0
              extraPlan.taken[a] += amount
              mergedTaken[a] += amount
              if (!isPensionIncome(a)) extraPlan.nonEligible[i] += amount
            })
            extraPlan.registered[i] += take
          })
          if (sum(extraPlan.taken) > 0) meltdownPlan = extraPlan
        }
      }

      const finalPlan = meltdownPlan ? mergePlans(planned, meltdownPlan) : planned
      applyWithdrawal(finalPlan)
      recordWithdrawal(finalPlan)
      planned = finalPlan
      const withdrawal = sum(finalPlan.taken)
      if (meltdownPlan) row.meltdownWithdrawals = sum(meltdownPlan.taken)
      row.withdrawalShortfall = Math.max(0, target - withdrawal)
      if (!solvedExactly) row.shortfall = row.withdrawalShortfall

      if (v2) {
        const inputs = taxInputs(finalPlan.registered, noDeduction, undefined, finalPlan.nonEligible)
        const household = householdTax(inputs)
        recordTax(household)
        recordGis(inputs)
        settleReceiptTax(finalPlan.registered, finalPlan.nonEligible, noDeduction)

        // Cash withdrawn beyond what the strategy needed is reinvested after
        // its share of tax.
        // The tax on that cash is the difference from taxing only what the
        // strategy needed; forced excess is attributed in proportion to each
        // person's registered withdrawals.
        const unneeded = forcedExcess + row.meltdownWithdrawals
        if (unneeded > 0) {
          const registeredTotal = Math.max(1, sum(finalPlan.registered))
          const neededRegistered = finalPlan.registered.map((v, i) =>
            Math.max(0, v - (meltdownPlan?.registered[i] ?? 0) - forcedExcess * (v / registeredTotal)))
          const neededNonEligible = finalPlan.nonEligible.map((v, i) => (finalPlan.registered[i] > 0 ? v * (neededRegistered[i] / finalPlan.registered[i]) : 0))
          // Measured without the year's one-time costs: they settled their own tax
          // when they were paid, and shouldn't shift tax onto this reinvestment.
          const neededInputs = taxInputs(
            neededRegistered.map((v, i) => v - oneOff.registered[i]),
            noDeduction,
            undefined,
            neededNonEligible.map((v, i) => v - oneOff.nonEligible[i]),
          )
          const neededTax = householdTax(neededInputs).total * k + oneOffCash()
          // The extra income can also reduce GIS that was helping pay for
          // spending, so that money isn't available to reinvest either.
          const lostGis = Math.max(0, sum(gisFor(neededInputs)) * k - row.gis)
          reinvest(unneeded - Math.max(0, row.tax - neededTax) - lostGis, aliveIdx[0])
        }

        if (t === c.headlineOffset) {
          const withoutRegistered = householdTax(taxInputs(zeros(), zeros()))
          snapshot = {
            taxWithoutRegisteredWithdrawals: withoutRegistered.total * k,
            marginalRatePct: c.people.map((_, i) => {
              const m = aliveIdx.indexOf(i)
              return m < 0 ? 0 : marginalTaxRate({ ...(period < 1 ? annualizedMember(inputs[m], period, true) : inputs[m]), pensionSplit: household.splits[m], quebecPensionSplit: household.quebecSplits[m] }, taxOpts)
            }),
          }
        }
      } else {
        const tax = computeRetirementTaxSummary({
          people: peopleYear.map((p, i) => ({
            name: c.people[i].name,
            ageAtRetirement: p.age,
            pension: p.pension / k,
            cpp: p.cpp / k,
            oas: p.oas / k,
          })),
          rrspAtRetirement: taxableBalance / k,
          tfsaAtRetirement: (available - taxableBalance) / k,
          portfolioWithdrawal: withdrawal / k,
        })
        row.tax = tax.totalTax * k
        row.oasClawback = tax.oasClawback * k
        tax.perPerson.forEach((p, i) => {
          peopleYear[i].tax = p.total * k
          peopleYear[i].federal = p.federal * k
          peopleYear[i].provincial = p.quebec * k
          peopleYear[i].oasClawback = p.oasClawback * k
          peopleYear[i].registeredWithdrawals = p.rrifWithdrawal * k
          peopleYear[i].taxableIncome = p.taxableIncome * k
        })
        if (t === D) {
          snapshot = {
            taxWithoutRegisteredWithdrawals: (tax.totalTax - tax.rrspTax) * k,
            marginalRatePct: tax.perPerson.map(p => p.marginalRate),
          }
        }
      }

      row.guaranteedIncome = peopleYear.reduce((s, p) => s + p.pension + p.cpp + p.oas + p.gis, 0)
      const employment = v2 ? employmentTotal() : 0
      row.grossIncome = row.guaranteedIncome + row.otherIncome + employment + withdrawal + oneOffCash() - row.reinvested
      // Not clamped for funding: tax the year's cash can't pay is also unfunded.
      let netCash = row.guaranteedIncome + row.otherIncome + employment + withdrawal + oneOffCash() - row.tax - payrollTotal() - row.reinvested + withheld + receiptTaxWithheld
      row.afterTaxIncome = Math.max(0, netCash)

      // Saving still scheduled in retirement is paid from what is left after
      // spending. Its deduction feeds back into the tax, so the share is solved.
      let fundedSaving = 0
      let yearDeductionAtEnd = noDeduction
      if (v2 && scheduledSaving > 0) {
        const taxBefore = row.tax + payrollTotal()
        const savingAt = (share: number) => {
          esppShare = share
          const household = householdTax(taxInputs(finalPlan.registered, deductionsFor(contributions.map(amount => amount * share)), undefined, finalPlan.nonEligible))
          const taxChange = taxBefore - (household.total + household.perPerson.reduce((s, res) => s + res.payroll.total, 0)) * k
          return { household, taxChange, cash: netCash + taxChange - row.spending - scheduledSaving * share }
        }
        const share = fundedSavingShare(s => savingAt(s).cash)
        row.missedContributions = scheduledSaving * (1 - share)
        row.excessContributions = excessTotal * share
        if (share > 0) {
          const { household, taxChange } = savingAt(share)
          const funded = contributions.map(amount => amount * share)
          fundedSaving = scheduledSaving * share
          netCash += taxChange
          row.afterTaxIncome = Math.max(0, netCash)
          recordTax(household)
          useFhsaRoom(funded)
          countTowardRoom(funded)
          contributionsAtYearEnd = funded
          esppShare = share
          yearDeductionAtEnd = deductionsFor(funded)
        } else {
          esppShare = 0
        }
      }

      // Simple mode with a fixed rate: the test is whether income reaches the
      // target, not whether the fixed withdrawal could be made, which always can.
      if (v2 && !detailed && c.spendingStrategy.kind === 'initialPct') {
        const unmet = row.spending - row.grossIncome
        row.shortfall = unmet > 1 ? unmet : 0
      }

      if (detailed) {
        row.surplus = netCash - row.spending - fundedSaving
        if (row.surplus > 1 && solvedExactly) reinvest(row.surplus, aliveIdx[0])
        else if (row.surplus > 0 && c.savingsAccount >= 0) toSave = row.surplus
        const deadband = (x: number) => (x > 1 ? x : 0)
        row.budgetShortfall = deadband(row.spending - netCash)
        row.essentialShortfall = deadband(essentialNeed - netCash)
        row.fundedSpending = Math.max(0, row.spending - row.budgetShortfall)
        // Percent-of-portfolio, guardrail and VPW plans cut spending on
        // purpose; for them only an unfunded essential is a failure.
        const flexible = c.spendingStrategy.kind === 'pctPortfolio' || c.spendingStrategy.kind === 'guytonKlinger' || c.spendingStrategy.kind === 'vpw'
        row.shortfall = flexible ? row.essentialShortfall : row.budgetShortfall
      }

      yearReturn = { registered: finalPlan.registered, nonEligible: finalPlan.nonEligible, deduction: yearDeductionAtEnd }
      accrueDistributions()

      // Strategies work in yearly amounts, whatever this row covered.
      strategy.lastWithdrawal = Math.min(target, withdrawal) / k / period
      strategy.lastReturn = r
      strategy.lastInflation = path.inflation[t] ?? 0

      for (let a = 0; a < accountCount; a++) {
        const balanceBefore = balances[a]
        if (c.accounts[a].stock) growStock(a, t)
        else balances[a] *= 1 + accountReturn[a]
        row.growth += balances[a] - balanceBefore
      }
      if (v2) settleEspp(esppShare)
      if (contributionsAtYearEnd) {
        contributionsAtYearEnd.forEach((amount, a) => {
          if (amount <= 0) return
          balances[a] += amount
          if (c.accounts[a].nonRegistered) acb[a] += amount
          if (c.accounts[a].stock) syncHoldings(a)
          row.contributions += amount
        })
      }
      // Ending a fully funded last year at zero isn't running out.
      const emptied = v2 ? sum(balances) < k && (t < years - 1 || row.shortfall > 1) : sum(balances) <= 0
      if (depletionOffset === null && emptied && (target > 1 || (v2 && row.shortfall > 1))) depletionOffset = t
    }

    // Debt payments the year's cash could not make stay owing: each debt is
    // re-amortized at the share of essentials that was actually paid.
    if (detailed && row.essentialShortfall > 1 && essentialNeed > 0) {
      const paidShare = Math.max(0, 1 - row.essentialShortfall / essentialNeed)
      c.debts.forEach((d, j) => {
        const scheduled = debtSteps[j]
        if (!scheduled) return
        const actual = amortizeYear(scheduled.opening, d.annualRate, d.monthlyPayment * paidShare, d.rateCompounding, debtMonths)
        debtBalance[j] += actual.balance - scheduled.step.balance
        row.debtPayments += actual.paid - scheduled.step.paid
      })
    }

    row.shortfall += oneOff.shortfall

    // Saved surpluses are invested at year end.
    if (toSave > 0) {
      deposit(c.savingsAccount, toSave)
      row.saved = toSave
    }

    // A closing FHSA rolls into the holder's RRSP on the last day of the year.
    c.accounts.forEach((acct, a) => {
      if (acct.fhsa && row.year >= acct.fhsa.closureYear && balances[a] > 0) {
        balances[acct.fhsa.rolloverAccount] += balances[a]
        balances[a] = 0
      }
    })

    // Cash accounts have no capital gains: their cost base is their balance.
    c.accounts.forEach((a, i) => { if (a.interestOnly) acb[i] = balances[i] })

    // Homes appreciate at inflation plus their real rate.
    c.properties.forEach((prop, p) => {
      if (propertyOwned[p]) propertyValue[p] *= (1 + (path.inflation[t] ?? 0)) * Math.pow(1 + prop.appreciationReal, period)
    })

    // Contribution room: new room arrives each January; TFSA withdrawals are
    // added back the following year.
    for (let i = 0; i < peopleCount; i++) {
      if (v2) {
        rrspRoom[i] -= contributedTo.rrsp[i]
        if (c.people[i].rrspRoom !== undefined) peopleYear[i].rrspRoom = rrspRoom[i]
      }
      if (!Number.isNaN(tfsaRoom[i])) {
        if (t > 0 && peopleYear[i].age >= 18) tfsaRoom[i] += LIMITS.tfsaAnnual * k + priorTfsaWithdrawals[i]
        tfsaRoom[i] -= contributedTo.tfsa[i]
        peopleYear[i].tfsaRoom = tfsaRoom[i]
      }
    }
    priorTfsaWithdrawals = tfsaWithdrawals

    // FHSA room: a new year's limit plus up to one year of unused room.
    for (let i = 0; i < peopleCount; i++) {
      fhsaYearRoom[i] = LIMITS.fhsaAnnual + Math.min(LIMITS.fhsaAnnual, Math.max(0, fhsaYearRoom[i]))
    }

    peopleYear.forEach((p, i) => {
      p.investmentIncome = invOrdinary[i] + invEligible[i]
      p.realizedGains = realized[i]
    })

    if (v2) {
      const yearInputs = taxInputs(yearReturn.registered, yearReturn.deduction, undefined, yearReturn.nonEligible)
      yearInputs.forEach((m, index) => {
        priorGisIncome[aliveIdx[index]] = gisIncomeOf(period < 1 ? annualizedMember(m, period, true) : m)
      })
      if (t === years - 1) {
        finalInputs = yearInputs
        finalAlive = aliveIdx
      }
    }

    // A net capital loss can only be used against later gains; it ends with
    // its owner. Applied after the year's own inputs are read.
    for (const i of aliveIdx) {
      if (!v2) break
      const net = incomeByPerson[i].capitalGains[t] + realized[i]
      lossCarry[i] = net < 0 ? lossCarry[i] - net : Math.max(0, lossCarry[i] - net)
    }

    c.accounts.forEach((acct, a) => {
      if (acct.type === 'LIRA' && takenThisYear[a] > 0) liraPaying[a] = true
    })
    row.investmentIncome = sum(invOrdinary) + sum(invEligible)
    row.realizedGains = sum(realized)
    row.balancesEnd = balances.slice()
    row.stockValue = stockAccounts.reduce((s, a) => s + balances[a], 0)
    row.propertyValue = sum(propertyValue)
    row.debtBalance = sum(debtBalance)
    row.netWorth = sum(balances) + row.propertyValue - row.debtBalance
    rows.push(row)
  }

  const estate = v2
    ? computeEstate(c, rows, balances, acb, propertyValue, propertyAcb, propertyOwned, {
        inputs: finalInputs,
        alive: finalAlive,
        lossCarry,
        realValues: Object.fromEntries([...realValuesByProvince].map(([province, values]) => [province, values[years - 1]])),
      })
    : null
  return { rows, snapshot, estate, depletionOffset }
}

// Deemed disposition at the last death: registered balances are income on the
// final return and unrealized capital gains are realized; a principal
// residence is exempt. Probate applies to what passes through the estate.
// Everything goes on one return, including when a couple's deaths fall in the
// same plan year, because a spousal rollover leaves it all with the survivor.
function computeEstate(
  c: CompiledPlan,
  rows: YearRow[],
  balances: number[],
  acb: number[],
  propertyValue: number[],
  propertyAcb: number[],
  propertyOwned: boolean[],
  final: { inputs: TaxMember[]; alive: number[]; lossCarry: number[]; realValues: Partial<Record<ProvinceCode, RealValues>> },
): EstateResult | null {
  const last = rows[rows.length - 1]
  if (!last || c.people.length === 0) return null
  // The last survivor (latest life expectancy).
  const lastIndex = c.people.reduce((best, p, i) => (p.endOffset > c.people[best].endOffset ? i : best), 0)
  const person = c.people[lastIndex]
  const k = last.cpi

  const registered = c.accounts.reduce((s, a, i) => s + (a.taxable ? balances[i] : 0), 0)
  // Netted across holdings: a loss on one offsets a gain on another.
  const securitiesGains = c.accounts.reduce((s, a, i) => s + (a.nonRegistered ? balances[i] - acb[i] : 0), 0)
  const propertyGains = c.properties.reduce((s, p, i) => s + (propertyOwned[i] && !p.principalResidence ? Math.max(0, propertyValue[i] - propertyAcb[i]) : 0), 0)
  const deemedGains = Math.max(0, securitiesGains + propertyGains - final.lossCarry[lastIndex])
  const gross = last.netWorth

  // Incremental tax over the final year's actual return: the OAS clawback, age
  // and pension credits, dividends and deductions all stay as they were.
  const m = final.alive.indexOf(lastIndex)
  const base: IncomeTaxInput = m >= 0
    ? { ...final.inputs[m], pensionSplit: 0 }
    : emptyIncome(person.province, last.people[lastIndex].age)
  const taxOptions = { deflator: 1 / k, realValues: final.realValues }
  const finalReturnTax = Math.max(0, computeIncomeTax({
    ...base,
    registeredWithdrawals: base.registeredWithdrawals + registered / k,
    nonEligibleRegistered: (base.nonEligibleRegistered ?? 0) + registered / k,
    capitalGains: base.capitalGains + deemedGains / k,
  }, taxOptions).total - computeIncomeTax(base, taxOptions).total) * k
  // On the estate as a whole, before income tax: a province's probate base is
  // the value of the estate, not what is left after the final return.
  const probate = c.probate ? probateFee(person.province, Math.max(0, gross)) : 0

  return {
    year: last.year,
    cpi: last.cpiEnd,
    grossEstate: gross,
    finalReturnTax,
    probate,
    afterTaxEstate: Math.max(0, gross - finalReturnTax - probate),
  }
}
