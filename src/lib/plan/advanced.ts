import type { PlanSection } from '@/lib/ui/route'
import type { PlanV2 } from './schema'

// Settings that Essentials mode hides. Hiding an input never changes the
// plan, so when any of these differ from their defaults the section says so
// ("2 advanced settings are active") instead of silently applying them.

export interface AdvancedSetting {
  section: PlanSection
  label: string
}

const DEFAULT_ASSET_RETURNS = { equityPct: 6.6, bondPct: 3.4, cashPct: 2.4 }
const ESSENTIAL_STRATEGIES = new Set(['initialPct', 'expenses'])

export function advancedSettingsInUse(plan: PlanV2): AdvancedSetting[] {
  const out: AdvancedSetting[] = []
  const add = (section: PlanSection, label: string) => out.push({ section, label })
  const multi = plan.people.length > 1
  const who = (name: string) => (multi ? ` (${name})` : '')

  for (const person of plan.people) {
    const pensionName = person.province === 'QC' ? 'QPP' : 'CPP'
    if (person.cpp.mode === 'earnings') add('household', `${pensionName} from % of YMPE${who(person.name)}`)
    if (person.cpp.mode === 'history' && (person.cpp.yearsNotWorking > 0 || person.cpp.childRearingYears > 0)) {
      add('household', `${pensionName} work-history gaps${who(person.name)}`)
    }
    if (person.room !== undefined) add('household', `Contribution room tracking${who(person.name)}`)
  }

  for (const account of plan.accounts) {
    const name = account.label || account.type
    if (account.type === 'STOCK') continue
    if (account.returnOverridePct !== undefined) add('savings', `Custom return on ${name}`)
    if (account.contributions.some(c => c.indexed)) add('savings', `Inflation-indexed contributions to ${name}`)
    if (account.type === 'RRSP' && account.rrifConversionAge !== undefined) add('savings', `RRIF conversion age on ${name}`)
    if (account.type === 'NONREG') {
      const y = account.yields
      if (y && (y.interestPct > 0 || y.eligibleDividendPct > 0 || y.foreignDividendPct > 0)) add('savings', `Yearly distributions on ${name}`)
      if (account.acb !== undefined && account.acb !== account.balance) add('savings', `Cost base on ${name}`)
    }
  }

  for (const income of plan.incomes) {
    const db = income.db
    if (income.kind !== 'dbPension' || !db) continue
    if (db.indexationPctOfCpi !== 100 || db.survivorPct !== 60 || db.bridge) add('income', `Pension details for ${income.label || 'pension'}`)
  }

  const e = plan.expenses
  if (e.mode === 'detailed') {
    if (e.phases.length > 0) add('spending', 'Spending phases')
    if (e.items.some(i => i.frequency === 'everyNYears')) add('spending', 'Expenses every few years')
    if (e.items.some(i => i.frequency !== 'oneTime' && i.realGrowthPct !== 0)) add('spending', 'Expenses growing faster than inflation')
    if (e.surplusPolicy === 'save') add('spending', 'Investing leftover cash')
  }

  const d = plan.drawdown
  if (!ESSENTIAL_STRATEGIES.has(d.strategy.kind)) add('withdrawals', 'Flexible withdrawal strategy')
  if (d.order === 'custom') add('withdrawals', 'Custom withdrawal order')
  if (d.meltdown.enabled) add('withdrawals', 'RRSP meltdown')
  if (multi && d.rrifUseYoungerSpouseAge) add('withdrawals', "RRIF minimums on the younger spouse's age")
  if (!plan.estate.probate) add('withdrawals', 'Probate fees left out')

  const r = plan.assumptions.assetReturns
  if (r.equityPct !== DEFAULT_ASSET_RETURNS.equityPct || r.bondPct !== DEFAULT_ASSET_RETURNS.bondPct || r.cashPct !== DEFAULT_ASSET_RETURNS.cashPct) {
    add('assumptions', 'Custom asset-class returns')
  }

  return out
}
