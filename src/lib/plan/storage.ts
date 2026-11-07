import { z } from 'zod'
import { planSchema, uiPrefsSchema, type PlanV2, type UiPrefs } from './schema'
import { parsePlanData } from './migrate'
import { createDefaultPlan } from './defaults'

export const STORE_KEY = 'retireEh.v2'

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

export function loadStore(storage: KeyValueStore, now: Date): StoreState {
  const stored = storeFileSchema.safeParse(readJson(storage, STORE_KEY))
  if (stored.success) {
    // Parse plans one by one so a single corrupt plan does not wipe the rest.
    const plans = stored.data.plans
      .map(p => parsePlanData(p, { now, lenientV1: true }))
      .flatMap(r => (r.success ? [r.plan] : []))
    if (plans.length > 0) {
      const activePlanId = plans.some(p => p.id === stored.data.activePlanId) ? stored.data.activePlanId : plans[0].id
      const ids = new Set(plans.map(p => p.id))
      return {
        activePlanId,
        plans,
        uiPrefs: stored.data.uiPrefs,
        snapshots: stored.data.snapshots.filter(snap => ids.has(snap.planId)),
        baselines: stored.data.baselines.filter(b => ids.has(b.planId)),
      }
    }
  }

  const legacy = readLegacyStorage(storage)
  if (legacy) {
    const result = parsePlanData(legacy, { now, lenientV1: true })
    if (result.success) {
      return {
        activePlanId: result.plan.id,
        plans: [result.plan],
        uiPrefs: uiPrefsSchema.parse(result.uiPrefs),
        snapshots: [],
        baselines: [],
      }
    }
  }

  const plan = createDefaultPlan(now)
  return { activePlanId: plan.id, plans: [plan], uiPrefs: uiPrefsSchema.parse({}), snapshots: [], baselines: [] }
}

// Returns null when a plan is mid-edit and invalid (e.g. an emptied number
// field). Skipping the write keeps the last valid copy in storage.
export function serializeStore(state: StoreState): string | null {
  for (const plan of state.plans) {
    if (!planSchema.safeParse(plan).success) return null
  }
  return JSON.stringify({ schemaVersion: 2, ...state })
}
