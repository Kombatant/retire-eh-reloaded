import { useState, useCallback } from 'react'
import './App.css'
import { useDarkMode } from '@/hooks/useDarkMode'
import { PlanStoreProvider, usePlanStore } from '@/contexts/PlanStoreContext'
import { useAssumptions } from '@/contexts/AssumptionsContext'
import { ProjectionProvider } from '@/contexts/ProjectionContext'
import { usePersistence } from '@/hooks/usePersistence'
import { useAutoRefreshQuotes } from '@/hooks/useStockQuotes'
import { exportToYAML, downloadYAML, uploadYAML, type ImportedPlan } from '@/lib/yaml-utils'
import { buildShareUrl, clearShareHash, readSharePlanFromUrl } from '@/lib/share-link'
import { Header } from '@/components/Header'
import { Footer } from '@/components/Footer'
import { Tabs } from '@/components/Tabs'
import { PlanTab } from '@/components/dashboard/PlanTab'
import { OverviewTab } from '@/components/dashboard/OverviewTab'
import { ProjectionsTab } from '@/components/dashboard/ProjectionsTab'
import { LearnTab } from '@/components/dashboard/LearnTab'
import { RiskTab } from '@/components/dashboard/RiskTab'
import { CashFlowTab } from '@/components/dashboard/CashFlowTab'
import { CompareTab } from '@/components/dashboard/CompareTab'
import { TrackingTab } from '@/components/dashboard/TrackingTab'
import { ErrorBoundary } from '@/components/ErrorBoundary'

type TabId = 'overview' | 'plan' | 'projections' | 'cashflow' | 'risk' | 'compare' | 'tracking' | 'learn'

function AppContent() {
  const [activeTab, setActiveTab] = useState<TabId>('plan')
  const [isDarkMode, setIsDarkMode] = useDarkMode()
  const store = usePlanStore()
  const assumptions = useAssumptions()
  const { localStorageError, setLocalStorageError } = usePersistence()
  useAutoRefreshQuotes()
  const [pendingSharedPlan, setPendingSharedPlan] = useState<ImportedPlan | null>(() =>
    readSharePlanFromUrl(window.location.href)
  )
  const [shareNotice, setShareNotice] = useState<string | null>(null)
  const { activePlan, replaceActivePlan, setUiPrefs, setSelectedPersonId } = store

  const applyPlan = useCallback((imported: ImportedPlan) => {
    replaceActivePlan(imported.plan)
    if (Object.keys(imported.uiPrefs).length > 0) setUiPrefs(imported.uiPrefs)
    setSelectedPersonId(imported.plan.people[0]?.id ?? null)
  }, [replaceActivePlan, setUiPrefs, setSelectedPersonId])

  const handleExport = useCallback(() => {
    const yamlContent = exportToYAML(activePlan)
    const date = new Date().toISOString().split('T')[0]
    downloadYAML(yamlContent, `retirement-plan-${date}.yaml`)
  }, [activePlan])

  const handleShare = useCallback(async () => {
    const link = buildShareUrl(activePlan)
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link)
        setShareNotice('Share link copied. Anyone with the link can view these numbers.')
      } else {
        window.prompt('Copy this share link:', link)
      }
    } catch {
      window.prompt('Copy this share link:', link)
    }
  }, [activePlan])

  const handleImport = useCallback(async () => {
    const plan = await uploadYAML()
    if (!plan) return
    applyPlan(plan)
  }, [applyPlan])

  const handleLoadSharedPlan = useCallback(() => {
    if (!pendingSharedPlan) return
    applyPlan(pendingSharedPlan)
    clearShareHash()
    setPendingSharedPlan(null)
    setActiveTab('overview')
    setShareNotice('Shared plan loaded. You can edit it like your own plan.')
  }, [applyPlan, pendingSharedPlan])

  const handleDismissSharedPlan = useCallback(() => {
    clearShareHash()
    setPendingSharedPlan(null)
  }, [])

  const renderTab = () => {
    switch (activeTab) {
      case 'plan':
        return <PlanTab />
      case 'overview':
        return <OverviewTab />
      case 'projections':
        return <ProjectionsTab />
      case 'cashflow':
        return <CashFlowTab />
      case 'risk':
        return <RiskTab />
      case 'compare':
        return <CompareTab />
      case 'tracking':
        return <TrackingTab />
      case 'learn':
        return <LearnTab />
    }
  }

  return (
    <div className="min-h-screen bg-transparent flex flex-col">
      <Header
        isDarkMode={isDarkMode}
        showRealValues={assumptions.showRealValues}
        onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
        onToggleRealValues={() => assumptions.setShowRealValues(!assumptions.showRealValues)}
        onExport={handleExport}
        onImport={handleImport}
        onShare={handleShare}
      />
      {pendingSharedPlan && (
        <div className="max-w-7xl mx-auto w-full px-4 mt-2">
          <div className="bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800 rounded-lg p-3 text-sm text-indigo-800 dark:text-indigo-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="font-semibold">You've opened a shared retirement plan</div>
              <p className="mt-0.5 text-indigo-700 dark:text-indigo-300">
                {pendingSharedPlan.plan.people.map(p => p.name).join(' & ')} · Load it to explore the numbers.
                This will replace the plan currently saved in this browser.
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={handleLoadSharedPlan}
                className="h-9 px-3 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
              >
                Load shared plan
              </button>
              <button
                onClick={handleDismissSharedPlan}
                className="h-9 px-3 rounded-lg border border-indigo-300 dark:border-indigo-700 text-sm font-medium hover:bg-indigo-100 dark:hover:bg-indigo-900/50"
              >
                Keep my plan
              </button>
            </div>
          </div>
        </div>
      )}
      {shareNotice && (
        <div className="max-w-7xl mx-auto w-full px-4 mt-2">
          <div className="bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3 text-sm text-emerald-800 dark:text-emerald-200 flex items-center justify-between">
            <span>{shareNotice}</span>
            <button
              onClick={() => setShareNotice(null)}
              className="ml-3 text-emerald-600 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-100 font-medium"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      <Tabs activeTab={activeTab} onChange={(tab) => setActiveTab(tab as TabId)} />
      {localStorageError && (
        <div className="max-w-7xl mx-auto w-full px-4 mt-2">
          <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300 flex items-center justify-between">
            <span>{localStorageError}</span>
            <button
              onClick={() => setLocalStorageError(null)}
              className="ml-3 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-200 font-medium"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6 sm:py-8">
        <ErrorBoundary>
          {renderTab()}
        </ErrorBoundary>
      </main>
      <Footer />
    </div>
  )
}

export default function App() {
  return (
    <PlanStoreProvider>
      <ProjectionProvider>
        <AppContent />
      </ProjectionProvider>
    </PlanStoreProvider>
  )
}
