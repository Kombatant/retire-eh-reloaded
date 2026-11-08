import { z } from 'zod'
import { planSchema, uiPrefsSchema, type PlanV2, type UiPrefs } from './schema'
import { parsePlanData } from './migrate'
import { createDefaultPlan } from './defaults'

export const STORE_KEY = 'retireEh.v2'
// Untouched copies of stored data that could not be read in full.
export const RECOVERY_KEY = 'retireEh.v2.recovery'
const RECOVERY_LIMIT = 5

// A dated record of actual account balances (net-worth tracking).
export interface Snapshot {
  id: string
  planId: string
  date: string // YYYY-MM-DD
  balances: Record<string, number> // accountId → balance
  total: number
}

// A saved projection to compare actual balances against.
export interface Baseline {
  planId: string
  date: string
  // Projected end-of-year portfolio (nominal) by calendar year.
  portfolio: { year: number; value: number }[]
}

export interface StoreState {
  activePlanId: string
  plans: PlanV2[]
  uiPrefs: UiPrefs
  snapshots: Snapshot[]
  baselines: Baseline[]
}

const snapshotSchema = z.object({
  id: z.string(),
  planId: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  balances: z.record(z.string(), z.number()),
  total: z.number(),
})
const baselineSchema = z.object({
  planId: z.string(),
  date: z.string(),
  portfolio: z.array(z.object({ year: z.number(), value: z.number() })),
})

const storeFileSchema = z.object({
  schemaVersion: z.literal(2),
  activePlanId: z.string(),
  plans: z.array(z.unknown()),
  uiPrefs: uiPrefsSchema.prefault({}),
  snapshots: z.array(snapshotSchema).catch([]).default([]),
  baselines: z.array(baselineSchema).catch([]).default([]),
})

type KeyValueStore = Pick<Storage, 'getItem'>

function readJson(storage: KeyValueStore, key: string): unknown {
  const raw = storage.getItem(key)
  if (raw === null) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function readNumber(storage: KeyValueStore, key: string): number | undefined {
  const raw = storage.getItem(key)
  if (raw === null) return undefined
  const value = parseFloat(raw)
  return Number.isFinite(value) ? value : undefined
}

function readBoolean(storage: KeyValueStore, key: string): boolean | undefined {
  const raw = storage.getItem(key)
  return raw === null ? undefined : raw === 'true'
}

// The original app stored one plan as loose keys. Rebuild a v1 plan from them,
// filling the same defaults the old providers used.
export function readLegacyStorage(storage: KeyValueStore): unknown | null {
  const people = readJson(storage, 'people')
  if (!Array.isArray(people) || people.length === 0) return null

  const rawGifts = readJson(storage, 'plannedGifts')
  const gifts = Array.isArray(rawGifts) ? rawGifts : []

  return {
    version: '1.0',
    assumptions: {
      expectedReturn: readNumber(storage, 'expectedReturn') ?? 7,
      inflationRate: readNumber(storage, 'inflationRate') ?? 2.5,
      replacementRate: readNumber(storage, 'replacementRate') ?? 70,
      withdrawalRate: readNumber(storage, 'withdrawalRate') ?? 4,
      showRealValues: readBoolean(storage, 'showRealValues') ?? true,
      workingMarginalTaxRate: readNumber(storage, 'workingMarginalTaxRate') ?? 30,
      reinvestRrspRefund: readBoolean(storage, 'reinvestRrspRefund') ?? false,
      // Old stored gifts were never validated and may lack ids or labels.
      plannedGifts: gifts.map((g: Record<string, unknown>, i: number) => ({
        id: typeof g?.id === 'string' && g.id ? g.id : `gift-${i + 1}`,
        label: typeof g?.label === 'string' && g.label ? g.label : 'Gift',
        amount: Number(g?.amount) || 0,
        age: Math.round(Number(g?.age) || 65),
      })),
    },
    people: people.map((p: Record<string, unknown>) => ({
      ...p,
      annualIncome: Number(p?.annualIncome) || 0,
      annualPension: Number(p?.annualPension) || 0,
      accounts: Array.isArray(p?.accounts) ? p.accounts : [],
    })),
  }
}

// What could not be read from storage, and the original text it came from.
export interface StoreRecovery {
  raw: string
  problems: string[]
}

export interface RecoveryEntry extends StoreRecovery {
  savedAt: string
  acknowledged: boolean
}

function planLabel(plan: unknown, index: number): string {
  const name = plan && typeof plan === 'object' ? (plan as { name?: unknown }).name : undefined
  return typeof name === 'string' && name ? `"${name}"` : `Plan ${index + 1}`
}

export function loadStore(storage: KeyValueStore, now: Date): StoreState {
  return loadStoreWithRecovery(storage, now).state
}

// Loading never decides that data is disposable: anything it cannot use is
// reported along with the original text, so the caller can keep a copy before
// the next save replaces it.
export function loadStoreWithRecovery(storage: KeyValueStore, now: Date): { state: StoreState; recovery: StoreRecovery | null } {
  const raw = storage.getItem(STORE_KEY)
  const problems: string[] = []
  const finish = (state: StoreState) => ({ state, recovery: raw !== null && problems.length > 0 ? { raw, problems } : null })

  const json = readJson(storage, STORE_KEY)
  const stored = storeFileSchema.safeParse(json)
  if (raw !== null && !stored.success) problems.push('The saved data could not be read.')
  if (stored.success) {
    // Parse plans one by one so a single corrupt plan does not wipe the rest.
    const parsed = stored.data.plans.map(p => parsePlanData(p, { now, lenientV1: true }))
    parsed.forEach((result, i) => {
      if (!result.success) problems.push(`${planLabel(stored.data.plans[i], i)}: ${result.errors.join('; ')}`)
    })
    const plans = parsed.flatMap(r => (r.success ? [r.plan] : []))
    const rawFile = json as { snapshots?: unknown; baselines?: unknown }
    if (Array.isArray(rawFile.snapshots) && rawFile.snapshots.length !== stored.data.snapshots.length) {
      problems.push('Some balance snapshots could not be read.')
    }
    if (Array.isArray(rawFile.baselines) && rawFile.baselines.length !== stored.data.baselines.length) {
      problems.push('A saved baseline could not be read.')
    }
    if (plans.length > 0) {
      const activePlanId = plans.some(p => p.id === stored.data.activePlanId) ? stored.data.activePlanId : plans[0].id
      const ids = new Set(plans.map(p => p.id))
      return finish({
        activePlanId,
        plans,
        uiPrefs: stored.data.uiPrefs,
        snapshots: stored.data.snapshots.filter(snap => ids.has(snap.planId)),
        baselines: stored.data.baselines.filter(b => ids.has(b.planId)),
      })
    }
  }

  const legacy = readLegacyStorage(storage)
  if (legacy) {
    const result = parsePlanData(legacy, { now, lenientV1: true })
    if (result.success) {
      return finish({
        activePlanId: result.plan.id,
        plans: [result.plan],
        uiPrefs: uiPrefsSchema.parse(result.uiPrefs),
        snapshots: [],
        baselines: [],
      })
    }
  }

  const plan = createDefaultPlan(now)
  return finish({ activePlanId: plan.id, plans: [plan], uiPrefs: uiPrefsSchema.parse({}), snapshots: [], baselines: [] })
}

const recoveryEntrySchema = z.object({
  savedAt: z.string(),
  raw: z.string(),
  problems: z.array(z.string()),
  acknowledged: z.boolean().default(false),
})

export function readRecoveryEntries(storage: Pick<Storage, 'getItem'>): RecoveryEntry[] {
  const result = z.array(recoveryEntrySchema).safeParse(readJson(storage, RECOVERY_KEY))
  return result.success ? result.data : []
}

// Returns false when the copy could not be written. The caller must then not
// overwrite the original, which would be the only remaining copy.
export function preserveRecovery(storage: Pick<Storage, 'getItem' | 'setItem'>, recovery: StoreRecovery, now: Date): boolean {
  const entries = readRecoveryEntries(storage)
  if (entries.some(e => e.raw === recovery.raw)) return true
  const next = [...entries, { ...recovery, savedAt: now.toISOString(), acknowledged: false }].slice(-RECOVERY_LIMIT)
  try {
    storage.setItem(RECOVERY_KEY, JSON.stringify(next))
    return true
  } catch {
    return false
  }
}

export function acknowledgeRecovery(storage: Pick<Storage, 'getItem' | 'setItem'>): void {
  const entries = readRecoveryEntries(storage).map(e => ({ ...e, acknowledged: true }))
  try {
    storage.setItem(RECOVERY_KEY, JSON.stringify(entries))
  } catch {
    // The notice simply shows again next time.
  }
}

// Returns null when a plan is mid-edit and invalid (e.g. an emptied number
// field). Skipping the write keeps the last valid copy in storage.
// Why the store cannot be saved right now, for showing to the user.
export function storeSaveProblem(state: StoreState): string | null {
  for (const plan of state.plans) {
    const result = planSchema.safeParse(plan)
    if (!result.success) {
      const issue = result.error.issues[0]
      return `"${plan.name}" has an invalid value (${issue.path.join('.') || 'plan'}: ${issue.message}).`
    }
  }
  return null
}

export function serializeStore(state: StoreState): string | null {
  for (const plan of state.plans) {
    if (!planSchema.safeParse(plan).success) return null
  }
  return JSON.stringify({ schemaVersion: 2, ...state })
}
