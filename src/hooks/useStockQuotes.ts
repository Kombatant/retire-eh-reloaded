import { useEffect, useSyncExternalStore } from 'react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import type { PlanV2 } from '@/lib/plan/schema'
import { applyQuotes, setUsdCad } from '@/lib/plan/edits'
import {
  fetchUsdCad,
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
  rateError: string | null
  lastRun: string | null
  settings: MarketDataSettings
}

let status: QuoteStatus = { refreshing: false, errors: {}, rateError: null, lastRun: null, settings: loadMarketDataSettings() }
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

type PlanUpdater = (planId: string, fn: (p: PlanV2) => PlanV2) => void

// The response is applied to the plan that asked, even if another plan is
// open by the time it arrives.
async function runRefresh(plan: PlanV2, update: PlanUpdater) {
  const symbols = symbolsIn(plan)
  const { provider, apiKey } = status.settings
  if (symbols.length === 0 || status.refreshing) return
  setStatus({ refreshing: true })
  const result = await refreshQuotes(symbols, provider, apiKey)
  const fetchedAt = new Date().toISOString()
  if (result.usdCad || Object.keys(result.prices).length > 0) update(plan.id, p => applyQuotes(p, result.prices, fetchedAt, result.usdCad))
  setStatus({ refreshing: false, errors: result.errors, rateError: null, lastRun: fetchedAt })
}

// The exchange rate alone: the Bank of Canada needs no API key.
async function runRateRefresh(planId: string, update: PlanUpdater) {
  if (status.refreshing) return
  setStatus({ refreshing: true })
  try {
    const { rate, asOf } = await fetchUsdCad()
    update(planId, p => setUsdCad(p, rate, asOf))
    setStatus({ refreshing: false, rateError: null })
  } catch (error) {
    setStatus({ refreshing: false, rateError: error instanceof Error ? error.message : 'Could not get the exchange rate.' })
  }
}

export function useStockQuotes() {
  const { activePlan, updatePlan } = usePlanStore()
  const state = useSyncExternalStore(subscribe, () => status)
  return {
    ...state,
    refresh: () => runRefresh(activePlan, updatePlan),
    refreshRate: () => runRateRefresh(activePlan.id, updatePlan),
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
  const { activePlan, updatePlan } = usePlanStore()
  const { settings } = useSyncExternalStore(subscribe, () => status)
  useEffect(() => {
    if (!settings.autoRefresh || !settings.apiKey || autoRefreshed.has(activePlan.id)) return
    if (!needsRefresh(activePlan)) return
    autoRefreshed.add(activePlan.id)
    void runRefresh(activePlan, updatePlan)
  }, [activePlan, updatePlan, settings])
}
