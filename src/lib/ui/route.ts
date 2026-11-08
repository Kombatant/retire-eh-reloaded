// Hash routes: #/plan/savings, #/dashboard, #/projections/drawdown …
//
// Share links also live in the hash (#plan=…, see share-link.ts). Route
// hashes always start with "#/", so the two never collide: anything else is
// treated as "no route" and the default page is shown.

export const PLAN_SECTIONS = [
  'household', 'savings', 'income', 'spending', 'property', 'withdrawals', 'assumptions',
] as const
export type PlanSection = typeof PLAN_SECTIONS[number]

export const VIEWS = [
  'plan', 'dashboard', 'projections', 'cashflow', 'taxes', 'risk', 'proposals', 'compare', 'tracking', 'learn',
] as const
export type ViewId = typeof VIEWS[number]

export interface Route {
  view: ViewId
  // Section or sub-view inside the page, when the page has them.
  sub?: string
}

export const DEFAULT_ROUTE: Route = { view: 'plan', sub: 'household' }

export function isPlanSection(value: string | undefined): value is PlanSection {
  return PLAN_SECTIONS.includes(value as PlanSection)
}

export function parseRoute(hash: string): Route {
  if (!hash.startsWith('#/')) return DEFAULT_ROUTE
  const [view, sub] = hash.slice(2).split(/[/?]/).filter(Boolean).map(part => decodeURIComponent(part))
  if (!VIEWS.includes(view as ViewId)) return DEFAULT_ROUTE
  if (view === 'plan') return { view, sub: isPlanSection(sub) ? sub : 'household' }
  return sub ? { view: view as ViewId, sub } : { view: view as ViewId }
}

export function formatRoute(route: Route): string {
  return route.sub ? `#/${route.view}/${encodeURIComponent(route.sub)}` : `#/${route.view}`
}

export function sameRoute(a: Route, b: Route): boolean {
  return a.view === b.view && (a.sub ?? '') === (b.sub ?? '')
}
