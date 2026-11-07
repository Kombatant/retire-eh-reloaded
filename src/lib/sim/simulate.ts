import { getCppIncomeAtAge, getOasIncomeAtAge } from '@/lib/calculations'
import { computeRetirementTaxSummary, OAS_MAX_ANNUAL_2026 } from '@/lib/tax'
import { calculateFutureValue, sum } from './math'
import type { CompiledFlow, CompiledPlan, MarketPath, PersonYear, SimResult, YearRow } from './types'

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

// Deterministic year-by-year household simulation in nominal dollars.
//
// Conventions kept from the original engine so results match it:
// - Before the household starts drawing down, contributions are monthly and
//   growth compounds monthly at the nominal rate / 12.
// - In drawdown, the year's withdrawal comes out at the start of the year and
//   the remainder grows at the annual nominal rate.
// - The withdrawal is a constant real amount: initial rate × portfolio at the
//   start of drawdown, drawn pro rata from all accounts.
// - Tax is computed in plan-start dollars with today's brackets, then
//   converted back, which is equivalent to fully indexed brackets.
export function simulate(c: CompiledPlan, path: MarketPath): SimResult {
  const years = c.years
  const D = c.drawdownStartOffset
  const cpi = cumulativeCpi(path.inflation, years)
  const accountCount = c.accounts.length

  const contributionSeries = c.accounts.map(a => {
    const total = new Float64Array(years)
    for (const flow of a.contributions) addInto(total, flowSeries(flow, cpi, path.inflation))
    return total
  })

  const incomeByPerson = c.people.map(() => ({
    employment: new Float64Array(years),
    pension: new Float64Array(years),
    other: new Float64Array(years),
  }))
  for (const income of c.incomes) {
    const series = flowSeries(income.flow, cpi, path.inflation)
    const bucket = incomeByPerson[income.personIndex]
    if (income.kind === 'employment' || income.kind === 'selfEmployment') addInto(bucket.employment, series)
    else if (income.kind === 'dbPension') addInto(bucket.pension, series)
    else addInto(bucket.other, series)
  }

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

  for (let t = 0; t < years; t++) {
    const r = path.nominalReturn[t] ?? 0
    const balancesStart = balances.slice()
    const peopleYear: PersonYear[] = c.people.map((p, i) => {
      const age = c.startYear + t - p.birthYear
      const income = incomeByPerson[i]
      return {
        age,
        employment: income.employment[t],
        pension: income.pension[t],
        cpp: getCppIncomeAtAge(p.cppAt65, p.cppStartAge, age) * cpi[t],
        oas: getOasIncomeAtAge(OAS_MAX_ANNUAL_2026, p.oasStartAge, age) * cpi[t],
        tax: 0,
        oasClawback: 0,
      }
    })

    const row: YearRow = {
      offset: t,
      year: c.startYear + t,
      cpi: cpi[t],
      cpiEnd: cpi[t] * (1 + (path.inflation[t] ?? 0)),
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
      guaranteedIncome: peopleYear.reduce((s, p) => s + p.pension + p.cpp + p.oas, 0),
      grossIncome: 0,
      afterTaxIncome: 0,
    }

    if (t < D) {
      for (let a = 0; a < accountCount; a++) {
        const contribution = contributionSeries[a][t]
        row.contributions += contribution
        balances[a] = calculateFutureValue(balances[a], contribution / 12, r / 12, 12)
      }
    } else {
      if (t === D) withdrawalReal = (sum(balances) / cpi[t]) * (c.initialWithdrawalRatePct / 100)

      // One-time expenses come out first, pro rata.
      const expense = Math.min(sum(balances), oneTime[t])
      takeProRata(balances, expense)
      row.oneTimeExpenses = expense

      const available = sum(balances)
      const target = withdrawalReal * cpi[t]
      const withdrawal = Math.min(available, target)
      const taxableBalance = c.accounts.reduce((s, a, i) => s + (a.taxable ? balances[i] : 0), 0)

      const tax = computeRetirementTaxSummary({
        people: peopleYear.map((p, i) => ({
          name: c.people[i].name,
          ageAtRetirement: p.age,
          pension: p.pension / cpi[t],
          cpp: p.cpp / cpi[t],
          oas: p.oas / cpi[t],
        })),
        rrspAtRetirement: taxableBalance / cpi[t],
        tfsaAtRetirement: (available - taxableBalance) / cpi[t],
        portfolioWithdrawal: withdrawal / cpi[t],
      })

      const taken = takeProRata(balances, withdrawal)
      row.taxableWithdrawal = c.accounts.reduce((s, a, i) => s + (a.taxable ? taken[i] : 0), 0)
      row.taxFreeWithdrawal = withdrawal - row.taxableWithdrawal
      row.withdrawal = withdrawal
      row.shortfall = Math.max(0, target - withdrawal)
      row.tax = tax.totalTax * cpi[t]
      row.oasClawback = tax.oasClawback * cpi[t]
      tax.perPerson.forEach((p, i) => {
        peopleYear[i].tax = p.total * cpi[t]
        peopleYear[i].oasClawback = p.oasClawback * cpi[t]
      })
      row.grossIncome = row.guaranteedIncome + withdrawal
      row.afterTaxIncome = Math.max(0, row.grossIncome - row.tax)

      for (let a = 0; a < accountCount; a++) balances[a] *= 1 + r
      if (depletionOffset === null && sum(balances) <= 0 && target > 0) depletionOffset = t
    }

    row.balancesEnd = balances.slice()
    rows.push(row)
  }

  return { rows, depletionOffset }
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
