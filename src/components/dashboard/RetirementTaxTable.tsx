import { useAssumptions } from '@/contexts/AssumptionsContext'
import { useProjectionContext } from '@/contexts/ProjectionContext'
import { formatMoney } from '@/lib/formatting'
import { jurisdictionLabel } from '@/lib/tax'
import { ModeBadge } from '@/components/ui/ModeBadge'
import { Calculator } from 'lucide-react'

export function RetirementTaxTable() {
  const assumptions = useAssumptions()
  const projection = useProjectionContext()
  const tax = projection.retirementTax

  if (!tax) return null
  const jurisdiction = jurisdictionLabel(tax.perPerson.map(p => p.province))
  const anySplit = tax.perPerson.some(p => Math.abs(p.pensionSplit) > 1)

  return (
    <div className="card p-4 sm:p-6">
      <h2 className="mb-1 flex items-center gap-2 text-lg sm:text-xl font-semibold text-gray-800 dark:text-white">
        <Calculator className="h-5 w-5 text-indigo-500" />
        Estimated Retirement Tax Detail
        <ModeBadge showRealValues={assumptions.showRealValues} />
      </h2>
      <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
        Estimated at household retirement (age {projection.householdRetirementAge}) using 2026 federal and {jurisdiction} rules.
        RRSP/RRIF withdrawals are taxed to the account owner{anySplit ? ', with pension income splitting applied where it lowers household tax' : ''}.
      </p>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/60">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Gross income</div>
          <div className="mt-0.5 text-lg font-semibold text-gray-900 dark:text-white">${formatMoney(tax.preTaxIncome)}</div>
        </div>
        <div className="rounded-lg bg-rose-50 p-3 dark:bg-rose-900/20">
          <div className="text-[11px] uppercase tracking-wide text-rose-600 dark:text-rose-300">Total tax</div>
          <div className="mt-0.5 text-lg font-semibold text-rose-700 dark:text-rose-300">${formatMoney(tax.totalTax)}</div>
        </div>
        <div className="rounded-lg bg-emerald-50 p-3 dark:bg-emerald-900/20">
          <div className="text-[11px] uppercase tracking-wide text-emerald-600 dark:text-emerald-300">After-tax income</div>
          <div className="mt-0.5 text-lg font-semibold text-emerald-700 dark:text-emerald-300">${formatMoney(tax.afterTaxIncome)}</div>
          <div className="mt-0.5 text-[10px] text-emerald-700/80 dark:text-emerald-300/80">
            includes ${formatMoney(tax.taxFreeWithdrawal)} TFSA
          </div>
        </div>
        <div className="rounded-lg bg-indigo-50 p-3 dark:bg-indigo-900/20">
          <div className="text-[11px] uppercase tracking-wide text-indigo-600 dark:text-indigo-300">Effective / top marginal</div>
          <div className="mt-0.5 text-lg font-semibold text-indigo-700 dark:text-indigo-300">
            {tax.averageTaxRate.toFixed(1)}% / {tax.topMarginalRate.toFixed(1)}%
          </div>
          <div className="mt-0.5 text-[10px] text-indigo-700/80 dark:text-indigo-300/80">effective rate is on gross income</div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full min-w-[980px] border-collapse text-xs sm:text-sm">
          <thead className="bg-gray-50 text-left text-gray-500 dark:bg-gray-800/60 dark:text-gray-400">
            <tr>
              <th className="px-3 py-2 font-medium">Person</th>
              <th className="px-3 py-2 text-right font-medium">Pension</th>
              <th className="px-3 py-2 text-right font-medium">CPP</th>
              <th className="px-3 py-2 text-right font-medium">OAS</th>
              <th className="px-3 py-2 text-right font-medium">RRSP/RRIF</th>
              <th className="px-3 py-2 text-right font-medium">Taxable income</th>
              <th className="px-3 py-2 text-right font-medium">Federal</th>
              <th className="px-3 py-2 text-right font-medium">Provincial</th>
              <th className="px-3 py-2 text-right font-medium">Clawback</th>
              <th className="px-3 py-2 text-right font-medium">Total tax</th>
              <th className="px-3 py-2 text-right font-medium">After-tax*</th>
              <th className="px-3 py-2 text-right font-medium">Eff. / marg.</th>
            </tr>
          </thead>
          <tbody>
            {tax.perPerson.map(person => {
              const preTax = person.pension + person.cpp + person.oas + person.rrifWithdrawal
              const afterTax = Math.max(0, preTax - person.total)
              const effectiveRate = preTax > 0 ? (person.total / preTax) * 100 : 0
              return (
                <tr key={person.name} className="border-t border-gray-100 text-gray-700 dark:border-gray-700/60 dark:text-gray-300">
                  <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">{person.name}</td>
                  <td className="px-3 py-2 text-right">${formatMoney(person.pension)}</td>
                  <td className="px-3 py-2 text-right">${formatMoney(person.cpp)}</td>
                  <td className="px-3 py-2 text-right">${formatMoney(person.oas)}</td>
                  <td className="px-3 py-2 text-right">${formatMoney(person.rrifWithdrawal)}</td>
                  <td className="px-3 py-2 text-right">${formatMoney(person.taxableIncome)}</td>
                  <td className="px-3 py-2 text-right">${formatMoney(person.federal)}</td>
                  <td className="px-3 py-2 text-right">${formatMoney(person.provincial)}</td>
                  <td className="px-3 py-2 text-right text-amber-700 dark:text-amber-400">${formatMoney(person.oasClawback)}</td>
                  <td className="px-3 py-2 text-right font-medium text-rose-600 dark:text-rose-400">${formatMoney(person.total)}</td>
                  <td className="px-3 py-2 text-right font-medium text-emerald-700 dark:text-emerald-400">${formatMoney(afterTax)}</td>
                  <td className="px-3 py-2 text-right">
                    {effectiveRate.toFixed(1)}% / {person.marginalRate.toFixed(1)}%
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="border-t-2 border-gray-200 bg-gray-50 font-semibold text-gray-900 dark:border-gray-700 dark:bg-gray-800/60 dark:text-white">
            <tr>
              <td className="px-3 py-2">Household</td>
              <td className="px-3 py-2 text-right">${formatMoney(tax.perPerson.reduce((sum, p) => sum + p.pension, 0))}</td>
              <td className="px-3 py-2 text-right">${formatMoney(tax.perPerson.reduce((sum, p) => sum + p.cpp, 0))}</td>
              <td className="px-3 py-2 text-right">${formatMoney(tax.perPerson.reduce((sum, p) => sum + p.oas, 0))}</td>
              <td className="px-3 py-2 text-right">${formatMoney(tax.taxableWithdrawal)}</td>
              <td className="px-3 py-2 text-right">${formatMoney(tax.perPerson.reduce((sum, p) => sum + p.taxableIncome, 0))}</td>
              <td className="px-3 py-2 text-right">${formatMoney(tax.perPerson.reduce((sum, p) => sum + p.federal, 0))}</td>
              <td className="px-3 py-2 text-right">${formatMoney(tax.perPerson.reduce((sum, p) => sum + p.provincial, 0))}</td>
              <td className="px-3 py-2 text-right">${formatMoney(tax.oasClawback)}</td>
              <td className="px-3 py-2 text-right">${formatMoney(tax.totalTax)}</td>
              <td className="px-3 py-2 text-right">
                ${formatMoney(tax.perPerson.reduce((sum, p) => sum + Math.max(0, p.pension + p.cpp + p.oas + p.rrifWithdrawal - p.total), 0))}
              </td>
              <td className="px-3 py-2 text-right">
                {tax.averageTaxRate.toFixed(1)}% / {tax.topMarginalRate.toFixed(1)}%
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="mt-3 text-[11px] text-gray-500 dark:text-gray-400">
        * Per-person after-tax income covers taxable sources only. The household also withdraws $
        {formatMoney(tax.taxFreeWithdrawal)} tax-free from TFSAs, bringing total after-tax income to $
        {formatMoney(tax.afterTaxIncome)}.
      </p>
      <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
        Estimates only. Includes the main federal and provincial credits (basic, age, pension income), the OAS
        clawback, GIS, and pension income splitting (up to 50% of eligible pension income; RRIF income from age 65).
        TFSA withdrawals are tax-free and not shown as taxable income.
      </p>
    </div>
  )
}
