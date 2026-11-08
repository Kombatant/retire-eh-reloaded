import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { formatRoute, parseRoute, sameRoute, type Route } from '@/lib/ui/route'

interface RouteContextValue {
  route: Route
  navigate: (route: Route, options?: { replace?: boolean }) => void
}

const RouteContext = createContext<RouteContextValue | null>(null)

// Keeps the current page in the URL hash, so the browser's back and forward
// buttons move between pages and a page can be bookmarked.
export function RouteProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const navigate = useCallback((next: Route, options?: { replace?: boolean }) => {
    setRoute(current => (sameRoute(current, next) ? current : next))
    const hash = formatRoute(next)
    if (window.location.hash === hash) return
    if (options?.replace) {
      window.history.replaceState(null, '', hash)
    } else {
      window.history.pushState(null, '', hash)
    }
    window.scrollTo?.({ top: 0 })
  }, [])

  // pushState does not fire hashchange; browser back/forward fires popstate.
  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const value = useMemo(() => ({ route, navigate }), [route, navigate])
  return <RouteContext.Provider value={value}>{children}</RouteContext.Provider>
}

export function useRoute(): RouteContextValue {
  const context = useContext(RouteContext)
  if (!context) throw new Error('useRoute must be used inside RouteProvider')
  return context
}
