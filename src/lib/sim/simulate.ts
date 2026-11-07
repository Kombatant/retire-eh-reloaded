import { getCppIncomeAtAge, getOasIncomeAtAge } from '@/lib/calculations'
import { computeRetirementTaxSummary, OAS_MAX_ANNUAL_2026 } from '@/lib/tax/quebecLegacy'
import { computeHouseholdTax } from '@/lib/tax/household'
import { CAPITAL_GAINS_INCLUSION, marginalTaxRate, type IncomeTaxInput } from '@/lib/tax/personal'
import { oasAnnualAmount } from '@/lib/benefits/oas'
import { gisAnnual } from '@/lib/benefits/gis'
import { calculateFutureValue, sum } from './math'
import type { CompiledFlow, CompiledPlan, DrawdownSnapshot, MarketPath, PersonYear, SimResult, YearRow } from './types'

const DIVIDEND_GROSS_UP = 1.38

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

function addInto(target: Float64Array, source: Float64Array) {
  for (let i = 0; i < target.length; i++) target[i] += source[i]
}

interface IncomeBuckets {
  employment: Float64Array
  pension: Float64Array
  otherOrdinary: Float64Array
  eligibleDividends: Float64Array
  capitalGains: Float64Array
  nonTaxable: Float64Array
}

function bucketIncomes(c: CompiledPlan, cpi: Float64Array, inflation: Float64Array): IncomeBuckets[] {
  const years = c.years
  const buckets: IncomeBuckets[] = c.people.map(() => ({
    employment: new Float64Array(years),
    pension: new Float64Array(years),
    otherOrdinary: new Float64Array(years),
    eligibleDividends: new Float64Array(years),
    capitalGains: new Float64Array(years),
    nonTaxable: new Float64Array(years),
  }))
  for (const income of c.incomes) {
    const series = flowSeries(income.flow, cpi, inflation)
    const b = buckets[income.personIndex]
    if (income.taxTreatment === 'nonTaxable') addInto(b.nonTaxable, series)
    else if (income.taxTreatment === 'capitalGain') addInto(b.capitalGains, series)
    else if (income.taxTreatment === 'eligibleDividend') addInto(b.eligibleDividends, series)
    else if (income.kind === 'employment' || income.kind === 'selfEmployment') addInto(b.employment, series)
    else if (income.kind === 'dbPension' || income.kind === 'annuity') addInto(b.pension, series)
    else addInto(b.otherOrdinary, series)
  }
  return buckets
}

type TaxMember = Omit<IncomeTaxInput, 'pensionSplit'>

// Year-by-year household simulation in nominal dollars.
//
// Conventions kept from the original engine:
// - Before the household starts drawing down (when its last member retires),
//   contributions are monthly and growth compounds monthly at nominal rate / 12.
// - In drawdown, the year's withdrawal comes out at the start of the year and
//   the remainder grows at the annual nominal rate.
// - The withdrawal is a constant real amount: initial rate × portfolio at the
//   start of drawdown, drawn pro rata from all accounts.
// - Tax is computed in plan-start dollars with today's rules, which is
//   equivalent to fully indexed brackets. Jurisdictions that freeze their
//   thresholds get bracket creep through the tax engine's deflator.
//
// v2 rules (default) tax each person on their own income with provincial
// rules and pension splitting, and add GIS and realistic OAS. v1 rules
// reproduce the original engine for parity tests.
export function simulate(c: CompiledPlan, path: MarketPath): SimResult {
  const years = c.years
  const D = c.drawdownStartOffset
  const v2 = c.rules === 'v2'
  const cpi = cumulativeCpi(path.inflation, years)
  const accountCount = c.accounts.length
  const peopleCount = c.people.length
  const zeros = (): number[] => new Array(peopleCount).fill(0)

  const contributionSeries = c.accounts.map(a => {
    const total = new Float64Array(years)
    for (const flow of a.contributions) addInto(total, flowSeries(flow, cpi, path.inflation))
    return total
  })
  const incomeByPerson = bucketIncomes(c, cpi, path.inflation)

  // One-time expenses (e.g. gifts) before drawdown are reserved and paid at
  // the start of drawdown, in that year's dollars.
  const oneTime = new Float64Array(years)
  for (const expense of c.expenses) {
    if (!expense.oneTime) continue
    const start = expense.flow.startOffset
    if (start < 0 || start >= years) continue
    const at = Math.max(start, D)
    if (at >= years) continue
    oneTime[at] += expense.flow.amount * Math.pow(1 + expense.flow.ratePct / 100, start) * cpi[at]
  }

  const balances = c.accounts.map(a => Math.max(0, a.initialBalance))
  const rows: YearRow[] = []
  let withdrawalReal = 0
  let depletionOffset: number | null = null
  let snapshot: DrawdownSnapshot | null = null

  for (let t = 0; t < years; t++) {
    const r = path.nominalReturn[t] ?? 0
    const k = cpi[t]
    const balancesStart = balances.slice()

    const peopleYear: PersonYear[] = c.people.map((p, i) => {
      const age = c.startYear + t - p.birthYear
      const income = incomeByPerson[i]
      const oasReal = v2
        ? oasAnnualAmount({ age, startAge: p.oasStartAge, yearsInCanadaAfter18: p.yearsInCanadaAfter18 })
        : getOasIncomeAtAge(OAS_MAX_ANNUAL_2026, p.oasStartAge, age)
      return {
        age,
        employment: income.employment[t],
        pension: income.pension[t],
        cpp: getCppIncomeAtAge(p.cppAt65, p.cppStartAge, age) * k,
        oas: oasReal * k,
        gis: 0,
        otherIncome: v2
          ? income.otherOrdinary[t] + income.eligibleDividends[t] + income.capitalGains[t] + income.nonTaxable[t]
          : 0,
        registeredWithdrawals: 0,
        pensionSplit: 0,
        taxableIncome: 0,
        federal: 0,
        provincial: 0,
        tax: 0,
        oasClawback: 0,
        payroll: 0,
        rrspRefund: 0,
      }
    })

    const row: YearRow = {
      offset: t,
      year: c.startYear + t,
      cpi: k,
      cpiEnd: k * (1 + (path.inflation[t] ?? 0)),
      phase: t < D ? 'accumulation' : 'drawdown',
      people: peopleYear,
      balancesStart,
      balancesEnd: balancesStart,
      contributions: 0,
      oneTimeExpenses: 0,
      withdrawal: 0,
      taxableWithdrawal: 0,
      taxFreeWithdrawal: 0,
      shortfall: 0,
      tax: 0,
      oasClawback: 0,
      gis: 0,
      otherIncome: peopleYear.reduce((s, p) => s + p.otherIncome, 0),
      rrspRefunds: 0,
      guaranteedIncome: 0,
      grossIncome: 0,
      afterTaxIncome: 0,
    }

    // Real-dollar tax inputs for each person (v2 only).
    const taxInputs = (registered: number[], rrspDeduction: number[]): TaxMember[] =>
      c.people.map((p, i) => {
        const income = incomeByPerson[i]
        return {
          province: p.province,
          age: peopleYear[i].age,
          employment: income.employment[t] / k,
          pension: income.pension[t] / k,
          registeredWithdrawals: registered[i] / k,
          cpp: peopleYear[i].cpp / k,
          oas: peopleYear[i].oas / k,
          otherOrdinary: income.otherOrdinary[t] / k,
          eligibleDividends: income.eligibleDividends[t] / k,
          capitalGains: income.capitalGains[t] / k,
          rrspDeduction: rrspDeduction[i] / k,
        }
      })
    const taxOpts = { deflator: 1 / k, splitting: c.pensionSplitting }

    const applyTax = (inputs: TaxMember[]) => {
      const household = computeHouseholdTax(inputs, taxOpts)
      household.perPerson.forEach((res, i) => {
        const p = peopleYear[i]
        p.pensionSplit = household.splits[i] * k
        p.taxableIncome = res.taxableIncome * k
        p.federal = res.federal * k
        p.provincial = res.provincial * k
        p.oasClawback = res.oasClawback * k
        p.tax = res.total * k
        p.payroll = res.payroll.total * k
      })
      row.tax = household.total * k
      row.oasClawback = household.perPerson.reduce((s, res) => s + res.oasClawback, 0) * k
      return household
    }

    if (t < D) {
      const contributions = c.accounts.map((_, a) => contributionSeries[a][t])

      if (v2) {
        const rrspByPerson = zeros()
        c.accounts.forEach((a, i) => {
          if (a.type === 'RRSP' && a.ownerIndex >= 0) rrspByPerson[a.ownerIndex] += contributions[i]
        })
        const withDeduction = applyTax(taxInputs(zeros(), rrspByPerson))
        // The refund is the tax this person's RRSP deduction saves this year.
        c.refundTargets.forEach((target, i) => {
          if (target < 0 || rrspByPerson[i] <= 0) return
          const withoutOwn = rrspByPerson.map((v, j) => (j === i ? 0 : v))
          const without = computeHouseholdTax(taxInputs(zeros(), withoutOwn), taxOpts)
          const refund = Math.max(0, without.total - withDeduction.total) * k
          peopleYear[i].rrspRefund = refund
          contributions[target] += refund
          row.rrspRefunds += refund
        })
      }

      for (let a = 0; a < accountCount; a++) {
        row.contributions += contributions[a]
        balances[a] = calculateFutureValue(balances[a], contributions[a] / 12, r / 12, 12)
      }

      row.guaranteedIncome = peopleYear.reduce((s, p) => s + p.pension + p.cpp + p.oas + p.gis, 0)
      const employment = peopleYear.reduce((s, p) => s + p.employment, 0)
      const payroll = peopleYear.reduce((s, p) => s + p.payroll, 0)
      row.grossIncome = row.guaranteedIncome + row.otherIncome + employment
      row.afterTaxIncome = Math.max(0, row.grossIncome - row.tax - payroll)
    } else {
      if (t === D) withdrawalReal = (sum(balances) / k) * (c.initialWithdrawalRatePct / 100)

      // One-time expenses come out first, pro rata.
      const expense = Math.min(sum(balances), oneTime[t])
      takeProRata(balances, expense)
      row.oneTimeExpenses = expense

      const available = sum(balances)
      const target = withdrawalReal * k
      const withdrawal = Math.min(available, target)
      const taxableBalance = c.accounts.reduce((s, a, i) => s + (a.taxable ? balances[i] : 0), 0)
      const taken = takeProRata(balances, withdrawal)

      row.taxableWithdrawal = c.accounts.reduce((s, a, i) => s + (a.taxable ? taken[i] : 0), 0)
      row.taxFreeWithdrawal = withdrawal - row.taxableWithdrawal
      row.withdrawal = withdrawal
      row.shortfall = Math.max(0, target - withdrawal)

      if (v2) {
        // Registered withdrawals are taxed to the account owner; joint
        // accounts are split evenly.
        const registered = zeros()
        c.accounts.forEach((a, i) => {
          if (!a.taxable || taken[i] <= 0) return
          if (a.ownerIndex >= 0) registered[a.ownerIndex] += taken[i]
          else for (let j = 0; j < peopleCount; j++) registered[j] += taken[i] / peopleCount
        })
        registered.forEach((v, i) => { peopleYear[i].registeredWithdrawals = v })

        const inputs = taxInputs(registered, zeros())
        const household = applyTax(inputs)

        const gis = gisAnnual(inputs.map(m => ({
          receivesOas: m.oas > 0,
          employmentIncome: m.employment,
          otherIncome: m.pension + m.registeredWithdrawals + m.cpp + m.otherOrdinary +
            m.eligibleDividends * DIVIDEND_GROSS_UP + m.capitalGains * CAPITAL_GAINS_INCLUSION,
        })))
        gis.forEach((g, i) => { peopleYear[i].gis = g * k })
        row.gis = sum(gis) * k

        if (t === D) {
          const withoutRegistered = computeHouseholdTax(taxInputs(zeros(), zeros()), taxOpts)
          snapshot = {
            taxWithoutRegisteredWithdrawals: withoutRegistered.total * k,
            marginalRatePct: inputs.map((m, i) => marginalTaxRate({ ...m, pensionSplit: household.splits[i] }, taxOpts)),
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
      row.grossIncome = row.guaranteedIncome + row.otherIncome + withdrawal
      row.afterTaxIncome = Math.max(0, row.grossIncome - row.tax)

      for (let a = 0; a < accountCount; a++) balances[a] *= 1 + r
      if (depletionOffset === null && sum(balances) <= 0 && target > 0) depletionOffset = t
    }

    row.balancesEnd = balances.slice()
    rows.push(row)
  }

  return { rows, snapshot, depletionOffset }
}

// Withdraw `amount` from accounts in proportion to their balances. Returns the
// amount taken from each account.
function takeProRata(balances: number[], amount: number): number[] {
  const total = sum(balances)
  const taken = balances.map(() => 0)
  if (amount <= 0 || total <= 0) return taken
  const share = Math.min(1, amount / total)
  for (let i = 0; i < balances.length; i++) {
    taken[i] = balances[i] * share
    balances[i] -= taken[i]
  }
  return taken
}
