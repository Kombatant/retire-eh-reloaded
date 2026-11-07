import { useEffect, useSyncExternalStore } from 'react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import type { PlanV2 } from '@/lib/plan/schema'
import { applyQuotes } from '@/lib/plan/edits'
import {
  isStale,
  loadMarketDataSettings,
  refreshQuotes,
  saveMarketDataSettings,
  type MarketDataSettings,
} from '@/lib/market/quotes'

// Shared quote state, so the Refresh button and the automatic daily refresh
// see the same status.
interface QuoteStatus {
  refreshing: boolean
  errors: Record<string, string>
  lastRun: string | null
  settings: MarketDataSettings
}

let status: QuoteStatus = { refreshing: false, errors: {}, lastRun: null, settings: loadMarketDataSettings() }
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const setStatus = (patch: Partial<QuoteStatus>) => {
  status = { ...status, ...patch }
  listeners.forEach(l => l())
}
// Plans already auto-refreshed in this session.
const autoRefreshed = new Set<string>()

export function symbolsIn(plan: PlanV2): string[] {
  return plan.accounts.flatMap(a => (a.type === 'STOCK' ? a.holdings.map(h => h.symbol) : [])).filter(s => s.trim())
}

function needsRefresh(plan: PlanV2): boolean {
  return plan.accounts.some(a => a.type === 'STOCK' && a.holdings.some(h => h.symbol.trim() && isStale(h.lastQuote?.fetchedAt)))
}

async function runRefresh(plan: PlanV2, update: (fn: (p: PlanV2) => PlanV2) => void) {
  const symbols = symbolsIn(plan)
  const { provider, apiKey } = status.settings
  if (symbols.length === 0 || status.refreshing) return
  setStatus({ refreshing: true })
  const result = await refreshQuotes(symbols, provider, apiKey)
  const fetchedAt = new Date().toISOString()
  if (Object.keys(result.prices).length > 0) update(p => applyQuotes(p, result.prices, fetchedAt))
  setStatus({ refreshing: false, errors: result.errors, lastRun: fetchedAt })
}

export function useStockQuotes() {
  const { activePlan, updateActivePlan } = usePlanStore()
  const state = useSyncExternalStore(subscribe, () => status)
  return {
    ...state,
    refresh: () => runRefresh(activePlan, updateActivePlan),
    setSettings: (patch: Partial<MarketDataSettings>) => {
      const settings = { ...status.settings, ...patch }
      saveMarketDataSettings(settings)
      setStatus({ settings })
    },
  }
}

// Mounted once in the app shell: refresh stale prices (fetched before today)
// when a plan with stock symbols is opened, if a key is saved.
export function useAutoRefreshQuotes() {
  const { activePlan, updateActivePlan } = usePlanStore()
  const { settings } = useSyncExternalStore(subscribe, () => status)
  useEffect(() => {
    if (!settings.autoRefresh || !settings.apiKey || autoRefreshed.has(activePlan.id)) return
    if (!needsRefresh(activePlan)) return
    autoRefreshed.add(activePlan.id)
    void runRefresh(activePlan, updateActivePlan)
  }, [activePlan, updateActivePlan, settings])
}
