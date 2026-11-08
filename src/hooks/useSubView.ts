import { useCallback } from 'react'
import { useRoute } from '@/contexts/RouteContext'

// The selected sub-view of a page, kept in the URL (#/taxes/by-year) so it
// survives a reload and can be linked to. Switching replaces the history
// entry, so Back leaves the page instead of stepping through its tabs.
export function useSubView<T extends string>(options: readonly T[], fallback: T): [T, (next: T) => void] {
  const { route, navigate } = useRoute()
  const current = options.includes(route.sub as T) ? (route.sub as T) : fallback
  const set = useCallback((next: T) => navigate({ view: route.view, sub: next }, { replace: true }), [navigate, route.view])
  return [current, set]
}
