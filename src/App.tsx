import { useMemo, useState, useCallback, type ReactNode } from 'react'
import './App.css'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { ToastProvider, useToast } from '@/contexts/ToastContext'
import { RouteProvider, useRoute } from '@/contexts/RouteContext'
import { PlanStoreProvider, usePlanStore } from '@/contexts/PlanStoreContext'
import { useAssumptions } from '@/contexts/AssumptionsContext'
import { ProjectionProvider } from '@/contexts/ProjectionContext'
import { usePersistence } from '@/hooks/usePersistence'
import { useAutoRefreshQuotes } from '@/hooks/useStockQuotes'
import { exportToYAML, downloadYAML, uploadYAML, type ImportedPlan } from '@/lib/yaml-utils'
import { buildShareUrl, clearShareHash, readSharePlanFromUrl } from '@/lib/share-link'
import { diagnosePlan } from '@/lib/plan/diagnostics'
import type { ViewId } from '@/lib/ui/route'
import { TopBar } from '@/components/layout/TopBar'
import { Sidebar, SidebarContent } from '@/components/layout/Sidebar'
import { Sheet } from '@/components/ui/Sheet'
import { Callout } from '@/components/ui/Callout'
import { Button } from '@/components/ui/Button'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { PlanView } from '@/views/plan/PlanView'
import { DashboardView } from '@/views/dashboard/DashboardView'
import { ProjectionsView } from '@/views/projections/ProjectionsView'
import { LearnView } from '@/views/learn/LearnView'
import { RiskView } from '@/views/risk/RiskView'
import { ProposalsView } from '@/views/proposals/ProposalsView'
import { CashFlowView } from '@/views/cashflow/CashFlowView'
import { CompareView } from '@/views/compare/CompareView'
import { TrackingView } from '@/views/tracking/TrackingView'
import { TaxesView } from '@/views/taxes/TaxesView'

const VIEWS: Record<ViewId, () => ReactNode> = {
  plan: () => <PlanView />,
  dashboard: () => <DashboardView />,
  projections: () => <ProjectionsView />,
  cashflow: () => <CashFlowView />,
  taxes: () => <TaxesView />,
  risk: () => <RiskView />,
  proposals: () => <ProposalsView />,
  compare: () => <CompareView />,
  tracking: () => <TrackingView />,
  learn: () => <LearnView />,
}

function AppContent() {
  const { route, navigate } = useRoute()
  const { notify } = useToast()
  const store = usePlanStore()
  const assumptions = useAssumptions()
  const { localStorageError, setLocalStorageError } = usePersistence()
  useAutoRefreshQuotes()
  const [navOpen, setNavOpen] = useState(false)
  const [pendingSharedPlan, setPendingSharedPlan] = useState<ImportedPlan | null>(() =>
    readSharePlanFromUrl(window.location.href)
  )
  const { activePlan, replaceActivePlan, setUiPrefs, setSelectedPersonId, saveProblem, recoveryEntries, acknowledgeRecoveryEntries, now } = store
  const diagnostics = useMemo(() => diagnosePlan(activePlan, now), [activePlan, now])

  const downloadRecovery = useCallback(() => {
    const text = JSON.stringify(recoveryEntries, null, 2)
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'retire-eh-recovered-data.json'
    link.click()
    URL.revokeObjectURL(url)
  }, [recoveryEntries])

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
        notify('Share link copied. Anyone with the link can see these numbers.')
      } else {
        window.prompt('Copy this share link:', link)
      }
    } catch {
      window.prompt('Copy this share link:', link)
    }
  }, [activePlan, notify])

  const handleImport = useCallback(async () => {
    const imported = await uploadYAML()
    if (!imported) return
    applyPlan(imported)
    notify(`Imported "${imported.plan.name}".`)
  }, [applyPlan, notify])

  const handleLoadSharedPlan = useCallback(() => {
    if (!pendingSharedPlan) return
    applyPlan(pendingSharedPlan)
    clearShareHash()
    setPendingSharedPlan(null)
    navigate({ view: 'dashboard' }, { replace: true })
    notify('Shared plan loaded. You can edit it like your own plan.')
  }, [applyPlan, pendingSharedPlan, navigate, notify])

  const handleDismissSharedPlan = useCallback(() => {
    clearShareHash()
    setPendingSharedPlan(null)
  }, [])

  return (
    <div className="min-h-screen bg-bg">
      <TopBar
        showRealValues={assumptions.showRealValues}
        onSetRealValues={assumptions.setShowRealValues}
        onExport={handleExport}
        onImport={handleImport}
        onShare={handleShare}
        onOpenNav={() => setNavOpen(true)}
      />
      <div className="flex">
        <Sidebar />
        <main className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
            {(pendingSharedPlan || localStorageError || saveProblem || recoveryEntries.length > 0 || diagnostics.length > 0) && (
              <div className="mb-6 space-y-3">
                {pendingSharedPlan && (
                  <Callout
                    tone="info"
                    title="You've opened a shared retirement plan"
                    actions={
                      <>
                        <Button variant="primary" size="sm" onClick={handleLoadSharedPlan}>Load shared plan</Button>
                        <Button size="sm" onClick={handleDismissSharedPlan}>Keep my plan</Button>
                      </>
                    }
                  >
                    {pendingSharedPlan.plan.people.map(p => p.name).join(' & ')}. Loading it replaces the plan
                    currently open in this browser.
                  </Callout>
                )}
                {recoveryEntries.length > 0 && (
                  <Callout
                    tone="danger"
                    title="Some saved data could not be loaded"
                    actions={
                      <>
                        <Button size="sm" onClick={downloadRecovery}>Download a copy</Button>
                        <Button size="sm" onClick={acknowledgeRecoveryEntries}>Dismiss</Button>
                      </>
                    }
                  >
                    An untouched copy is kept in this browser.
                    <ul className="mt-1 list-disc pl-5">
                      {recoveryEntries.flatMap(e => e.problems).map(problem => <li key={problem}>{problem}</li>)}
                    </ul>
                  </Callout>
                )}
                {saveProblem && (
                  <Callout tone="warning" title="Recent edits are not being saved">
                    {saveProblem} Saving resumes once it is corrected.
                  </Callout>
                )}
                {diagnostics.length > 0 && (
                  <Callout tone="warning" title="Check these plan settings">
                    <ul className="list-disc pl-5">
                      {diagnostics.map(d => <li key={d.message}>{d.message}</li>)}
                    </ul>
                  </Callout>
                )}
                {localStorageError && (
                  <Callout
                    tone="danger"
                    title="Your changes could not be saved"
                    actions={<Button size="sm" onClick={() => setLocalStorageError(null)}>Dismiss</Button>}
                  >
                    {localStorageError}
                  </Callout>
                )}
              </div>
            )}
            <ErrorBoundary key={route.view}>
              {VIEWS[route.view]()}
            </ErrorBoundary>
          </div>
        </main>
      </div>
      <Sheet open={navOpen} onClose={() => setNavOpen(false)} title="Retire, Eh?" side="left">
        <div className="-mx-5 -my-5 h-[calc(100%+2.5rem)]">
          <SidebarContent onNavigate={() => setNavOpen(false)} />
        </div>
      </Sheet>
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <RouteProvider>
          <PlanStoreProvider>
            <ProjectionProvider>
              <AppContent />
            </ProjectionProvider>
          </PlanStoreProvider>
        </RouteProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}
