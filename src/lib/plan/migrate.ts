import { retirementPlanSchema, validateYamlImport } from '@/lib/validation'
import type { RetirementPlan } from '@/types/plan'
import { planSchema, DEFAULT_USD_CAD, GIFT_CATEGORY, type PlanV2, type PlanV2Input, type UiPrefs } from './schema'
import { isoDate } from './defaults'
import { newId } from './ids'

export const CURRENT_SCHEMA_VERSION = 2

export type ParsePlanResult =
  | { success: true; plan: PlanV2; uiPrefs: Partial<UiPrefs>; migratedFrom: 1 | null }
  | { success: false; errors: string[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function detectSchemaVersion(data: unknown): 1 | 2 | null {
  if (!isRecord(data)) return null
  if (data.schemaVersion === 2) return 2
  if ('people' in data && 'assumptions' in data) return 1
  return null
}

function formatIssues(issues: { path: PropertyKey[]; message: string }[]): string[] {
  return issues.map(issue => {
    const path = issue.path.map(String).join('.')
    return path ? `${path}: ${issue.message}` : issue.message
  })
}

// v1 had nested accounts with ids that were only unique per person in practice.
function uniqueId(candidate: string, used: Set<string>): string {
  const resolved = used.has(candidate) ? newId('account') : candidate
  used.add(resolved)
  return resolved
}

// Map a validated v1 plan to v2. The mapping is chosen so the existing engine
// produces identical numbers:
// - ages become birth years relative to `now`
// - province is Quebec, because v1 always taxed as Quebec
// - salary stops and the employer pension starts at each person's retirement
// - gifts keep their position on the v1 household age axis (the youngest person's age)
export function migrateV1ToV2(
  v1: RetirementPlan,
  opts: { now: Date; id?: string; name?: string },
): { plan: PlanV2; uiPrefs: Partial<UiPrefs> } {
  const nowYear = opts.now.getFullYear()
  const usedAccountIds = new Set<string>()

  const people = v1.people.map(p => ({
    id: p.id,
    name: p.name,
    birthYear: nowYear - p.currentAge,
    province: 'QC' as const,
    retirementAge: p.retirementAge,
    lifeExpectancy: 95,
    cpp: { mode: 'amount' as const, amountAt65: p.annualCpp ?? 0 },
    cppStartAge: p.cppStartAge ?? 65,
    oas: { startAge: p.oasStartAge ?? 65, yearsInCanadaAfter18: 40 },
  }))

  const youngest = v1.people.reduce((best, p) => (p.currentAge < best.currentAge ? p : best), v1.people[0])

  const input: PlanV2Input = {
    schemaVersion: 2,
    id: opts.id ?? newId('plan'),
    name: opts.name ?? 'My plan',
    asOf: isoDate(opts.now),
    people,
    accounts: v1.people.flatMap(p => p.accounts.map(a => ({
      id: uniqueId(a.id, usedAccountIds),
      ownerId: p.id,
      type: a.type,
      label: '',
      balance: a.balance,
      contributions: a.annualContribution > 0
        ? [{ amount: a.annualContribution, indexed: false, to: { kind: 'retirement' as const, personId: p.id } }]
        : [],
    }))),
    incomes: v1.people.flatMap(p => [
      ...(p.annualIncome > 0 ? [{
        id: `${p.id}-salary`,
        ownerId: p.id,
        label: 'Salary',
        kind: 'employment' as const,
        amount: p.annualIncome,
        to: { kind: 'retirement' as const, personId: p.id },
        growth: { kind: 'cpi' as const },
      }] : []),
      ...(p.annualPension > 0 ? [{
        id: `${p.id}-pension`,
        ownerId: p.id,
        label: 'Employer pension',
        kind: 'dbPension' as const,
        amount: p.annualPension,
        from: { kind: 'retirement' as const, personId: p.id },
        growth: { kind: 'cpi' as const },
        db: { indexationPctOfCpi: 100 },
      }] : []),
    ]),
    expenses: {
      mode: 'simple',
      replacementRate: v1.assumptions.replacementRate,
      items: (v1.assumptions.plannedGifts ?? []).map(g => ({
        id: g.id,
        label: g.label,
        category: GIFT_CATEGORY,
        amount: g.amount,
        frequency: 'oneTime' as const,
        from: { kind: 'age' as const, personId: youngest.id, age: g.age },
        essential: false,
      })),
    },
    drawdown: { strategy: { kind: 'initialPct', ratePct: v1.assumptions.withdrawalRate } },
    assumptions: {
      expectedReturn: v1.assumptions.expectedReturn,
      inflationRate: v1.assumptions.inflationRate,
      workingMarginalTaxRate: v1.assumptions.workingMarginalTaxRate ?? 30,
      reinvestRrspRefund: v1.assumptions.reinvestRrspRefund ?? false,
    },
  }

  return { plan: planSchema.parse(input), uiPrefs: { showRealValues: v1.assumptions.showRealValues } }
}

// The first stock-portfolio release stored the share price in Canadian
// dollars (`price`). It is now entered in US dollars (`priceUsd`). A USD quote
// gives the exact USD price; otherwise convert at the plan's rate. The cost
// per share stays in Canadian dollars.
export function upgradeLegacyStockPrices(data: unknown): unknown {
  if (!isRecord(data) || !Array.isArray(data.accounts)) return data
  const assumptions = isRecord(data.assumptions) ? data.assumptions : {}
  const usdCad = isRecord(assumptions.usdCad) && typeof assumptions.usdCad.rate === 'number' && assumptions.usdCad.rate > 0
    ? assumptions.usdCad.rate
    : DEFAULT_USD_CAD
  let changed = false
  const accounts = data.accounts.map(account => {
    if (!isRecord(account) || account.type !== 'STOCK' || !Array.isArray(account.holdings)) return account
    const holdings = account.holdings.map(holding => {
      if (!isRecord(holding) || 'priceUsd' in holding || typeof holding.price !== 'number') return holding
      changed = true
      const { price, ...rest } = holding
      const quote = isRecord(holding.lastQuote) ? holding.lastQuote : null
      const priceUsd = quote?.currency === 'USD' && typeof quote.price === 'number'
        ? quote.price
        : Math.round(((price as number) / usdCad) * 10000) / 10000
      return { ...rest, priceUsd }
    })
    return { ...account, holdings }
  })
  return changed ? { ...data, accounts } : data
}

// Single entry point for every external plan source (YAML, share links,
// stored plans). Older formats are migrated forward, then validated as v2.
export function parsePlanData(data: unknown, opts: { now: Date; lenientV1?: boolean }): ParsePlanResult {
  const version = detectSchemaVersion(data)

  if (version === 2) {
    const result = planSchema.safeParse(upgradeLegacyStockPrices(data))
    if (!result.success) return { success: false, errors: formatIssues(result.error.issues) }
    return { success: true, plan: result.data, uiPrefs: {}, migratedFrom: null }
  }

  if (version === 1) {
    // Stored v1 data was never validated for age ordering, so localStorage
    // migration skips that check rather than discarding someone's plan.
    if (opts.lenientV1) {
      const result = retirementPlanSchema.safeParse(data)
      if (!result.success) return { success: false, errors: formatIssues(result.error.issues) }
      const { plan, uiPrefs } = migrateV1ToV2(result.data as RetirementPlan, { now: opts.now })
      return { success: true, plan, uiPrefs, migratedFrom: 1 }
    }
    const result = validateYamlImport(data)
    if (!result.success) return result
    const { plan, uiPrefs } = migrateV1ToV2(result.data as RetirementPlan, { now: opts.now })
    return { success: true, plan, uiPrefs, migratedFrom: 1 }
  }

  return { success: false, errors: ['Unrecognized plan format'] }
}
