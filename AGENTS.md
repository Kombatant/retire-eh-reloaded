# AGENTS.md

This file guides agentic coding agents working on Retire, Eh?, a Canadian retirement planning app.

## Build Commands

All commands should be run from the repository root:

- `npm install` - Install dependencies
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run typecheck` - Run TypeScript type checking
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Auto-fix linting issues
- `npm test` - Run all tests
- `npm test -- --watch` - Watch mode
- `npm test -- path/to/test.test.tsx` - Run single test file
- `npm test -- -t "test name"` - Run tests matching name

## Architecture

The application is 100% pure TypeScript (React + Vite). All calculations run client-side.

- **Unified engine** (`src/lib/sim/`):
  - `compilePlan(plan, { startYear })` resolves a v2 plan once.
  - `simulate(compiled, marketPath)` runs a year-by-year household simulation in nominal dollars.
  - `legacyAdapter.ts` turns the output into the series the existing charts use.
  - Deterministic projections, scenario bands and (later) Monte Carlo and backtests all reuse `simulate`.
- **Risk** (`src/lib/sim/risk.ts`, `paths/`): Monte Carlo (correlated lognormal asset returns plus AR(1) inflation, seeded), historical backtest over `src/data/historical/canada-annual.json`, and crash overlays. All run on `simulate`.
  - The Risk tab runs them in a Web Worker (`src/workers/sim.worker.ts`) through `useRiskAnalysis`.
  - Results stream in batches and are cached by plan.
  - In tests, where jsdom has no Worker, a small sample runs synchronously instead.
- **Insights** (`src/lib/insights/`): Sankey data, CSV export, FI and Coast FI, milestones, plan comparison and tax-bracket position. Each is a pure, tested helper.
- **Original engine** (`src/lib/legacy/`): kept only as the reference for `src/test/sim-parity.test.ts`.

## GitHub Actions

### CI Pipeline (`.github/workflows/ci.yml`)
- Runs on push/PR to `main` and `develop` branches
- Checks: Type check, lint, vitest tests, production build

### Deploy Pipeline (`.github/workflows/deploy.yml`)
- Runs on push to `main` branch
- Builds frontend production bundle
- Deploys to GitHub Pages: https://halfguru.github.io/retire-eh/

### Release Pipeline (`.github/workflows/release.yml`)
- Runs on version tags (`v*`, e.g., `v1.0.0`)
- Builds and creates GitHub Release with zip artifact
- Uses semantic versioning

## Philosophy Alignment

- Prioritize clarity over cleverness
- Comments should explain "why", not "what"
- Use conservative assumptions as defaults
- Use neutral, professional visuals and interactions

## UI Architecture

### Navigation

A grouped sidebar (a drawer on small screens) with hash routes. Each page shows one thing at a time; pages with several views use `SubTabs`, and the selected view is kept in the URL.

| Group | Page | Route | Contents |
|-------|------|-------|----------|
| — | Plan | `#/plan/<section>` | Inputs, one section at a time: household, savings, income, spending, property, withdrawals, assumptions. A live results rail sits beside them (a bottom bar on small screens). Default page. |
| Results | Dashboard | `#/dashboard` | Status and goal progress, 4 KPIs, lifetime savings chart, income sources, milestones, plan summary |
| | Projections | `#/projections/<growth\|drawdown\|benefits\|stocks>` | Saving years, retirement years and estate, CPP/OAS timing, stock scenarios (Advanced) |
| | Cash flow | `#/cashflow/<flow\|table>` | Yearly Sankey, year-by-year table with column presets and CSV export |
| | Taxes | `#/taxes/<retirement\|by-year\|brackets>` | Tax at retirement, tax by year, bracket room |
| | Risk | `#/risk/<monte-carlo\|historical\|stress>` | Success KPIs; fan chart, historical backtest, stress tests |
| Tools | Compare | `#/compare` | 2–3 saved plans side by side |
| | Tracking | `#/tracking` | Dated balance snapshots, actual vs. projected, rebaseline |
| — | Learn | `#/learn/<topic>` | Methodology articles |

Share links also use the hash (`#plan=…`). Route hashes always start with `#/`, so `parseRoute` ignores share hashes (`src/lib/ui/route.ts`).

The top bar has the plan menu (switch, new, duplicate, rename, delete), the Today's $ / Future $ switch, Share and a ⋯ menu (export/import YAML). The sidebar footer has the Advanced mode switch, the theme control (light/dark/system) and the version.

### Essentials / Advanced

`uiPrefs.detailLevel` (default `essentials`) hides rarely needed inputs and views. Wrap them in `<Advanced>` or use `useDetailLevel()`. Hiding never changes a value. When a hidden setting differs from its default, `advancedSettingsInUse` (`src/lib/plan/advanced.ts`) reports it and the Plan section shows a notice. Add new advanced inputs to that function.

### Code structure

```
src/components/ui/       building blocks: Button, Card, PageHeader, Field + inputs, Checkbox/Switch,
                         SegmentedControl, SubTabs, Sheet (native <dialog>), ListRow, AddMenu, Stat,
                         Badge/MoneyModeBadge, Callout, EmptyState, Disclosure, ChartLegend, Floating
src/components/layout/   TopBar, Sidebar, PlanMenu, navItems
src/views/<page>/        plan/ (PlanView, LiveRail, sections/), dashboard/, projections/, cashflow/,
                         taxes/, risk/, compare/, tracking/, learn/
src/lib/ui/              cn, styles (shared class strings), chartTheme, route, money
```

Provider order in `App.tsx`: ThemeProvider › ToastProvider › RouteProvider › PlanStoreProvider › ProjectionProvider › AppContent. Each page renders inside its own ErrorBoundary.

### Styling

- Colours are CSS variables in `src/index.css`, set for `:root` and `.dark` and exposed as Tailwind colours: `bg-bg`, `bg-surface`, `bg-surface-muted`, `border-border`, `text-fg`, `text-fg-secondary`, `text-fg-muted`, `accent`, `success`, `warning`, `danger`. Don't use raw Tailwind palette classes or `dark:` pairs.
- Charts take colours from `src/lib/ui/chartTheme.ts` (CSS variables, so they follow the theme). Each colour has one meaning across the app (RRSP, TFSA, CPP, tax…). The categorical order was checked for colour-blind safety; keep it.
- Status colours are always paired with an icon or words.
- Every money view shows a `MoneyModeBadge`. Views that ignore the dollars switch say so (`fixedReal` / `fixedNominal`).

### State Management

- The plan data model is versioned (`src/lib/plan/schema.ts`, zod, `schemaVersion: 2`). It is the single source of truth for persistence, YAML export and share links.
- Every external plan source (YAML, share links, stored plans) goes through `parsePlanData` in `src/lib/plan/migrate.ts`. Older v1 files are migrated forward there.
- `PlanStoreProvider` (`src/contexts/PlanStoreContext.tsx`) owns all saved plans, the active plan id, UI preferences (`showRealValues`, `detailLevel`) and person selection, via `useReducer`.
  - It persists everything under one localStorage key, `retireEh.v2`.
  - On first load it migrates the original loose keys.
- New UI uses `usePlanStore()` and the pure transforms in `src/lib/plan/edits.ts`. `usePeople` and `useAssumptions` are v1-shaped compatibility hooks.
- `ProjectionProvider` derives projection data from the active plan. `usePlanOutlook()` gives the live rail and Dashboard the same goal, income and "money lasts" figures (`src/lib/insights/outlook.ts`).
- The current page lives in the URL hash (`RouteProvider`, `useRoute`, `useSubView`).
- The theme lives in `ThemeProvider` (localStorage `retireEh.theme`; it reads the old `darkMode` key once). It is kept out of the plan and share links.

### Mobile

- The sidebar becomes a drawer; Plan sections become a scrolling chip row; the live rail becomes a bottom summary bar.
- Touch targets are at least 40–44px. Wide tables scroll inside their card.

## Testing

### Frontend tests (`npm test`)
- `plan-migration`, `plan-store`, `people-context`, `yaml-utils`, `share-link`, `validation`: data model, v1 → v2 migration, storage, import/export.
- `sim-parity`: the unified engine with v1 rules matches the original engine within $1. `engine`, `retirement-cash-flow`, `tax`, `cpp`, `oas*` cover the original modules.
- `tax-provinces`: hand-computed golden tax values, every jurisdiction, payroll, splitting, OAS/GIS/CPP.
- `sim-v2`, `sim-accounts`, `sim-spending`, `sim-drawdown`: engine behaviour (tax ownership, refunds, account types, room, income streams, budgets, real estate, RRIF/LIF, strategies, survivors, estate).
- `sim-risk`, `rng`: Monte Carlo, backtest, crash scenarios.
- `insights`, `outlook`: Sankey, CSV, FI metrics, milestones, comparison, brackets; goal outlook, income sources, money-lasts.
- `cpp-history`: CPP/QPP estimate from work history.
- `sim-stocks`, `stock-quotes`: stock holdings, RSU/ESPP, sell plans, scenarios, quote providers (mocked fetch).
- `route`, `advanced-settings`, `ui-primitives`: hash routes, Essentials/Advanced detection, Sheet/SegmentedControl/SubTabs/NumberInput/Field.
- `projection-consistency`, `narrative`, `app-smoke`: every page and Plan section renders; deep links; Advanced mode; theme; shared-plan flow.

### Shared Utilities
- `src/lib/sim/` - Unified year-by-year simulation engine (`steps/`: debts, solver, RRIF/LIF, spending strategies)
- `src/lib/sim/risk.ts` - Monte Carlo, historical backtest and stress tests on the unified engine
- `src/lib/tax/`:
  - `data/2026.ts`: 2026 tables for federal and all 13 jurisdictions, with sources. Update this file yearly.
  - `personal.ts`: income tax for one person.
  - `household.ts`: pension income splitting.
  - `payroll.ts`: CPP/QPP/EI.
  - `quebecLegacy.ts`: the original v1 estimator.
- `src/lib/benefits/`: CPP/QPP estimate and survivor pension, OAS (residency, deferral, +10% at 75), GIS.
- `src/lib/market/quotes.ts`: live stock quotes, fetched from the browser.
  - Providers: Twelve Data or Alpha Vantage, with the user's free API key.
  - USD→CAD conversion uses the Bank of Canada Valet API.
  - The key is stored in localStorage (`retireEh.marketData`) and never in the plan, so it isn't exported or shared.
  - `useAutoRefreshQuotes` (in App) refreshes stale prices once a day.
- Stock portfolio accounts (`type: 'STOCK'`): holdings with vested shares, unvested RSU tranches, ESPP, a bear/base/bull price projection, and a sell plan.
  - Vesting and the ESPP benefit are taxed as employment income.
  - `src/lib/insights/stockScenarios.ts` compares the three cases with and without the sell plan.
- `src/lib/formatting.ts` - `money()` / `moneyCompact()` (with `$`) and `formatMoney()` / `formatCompactMoney()` (digits only) for all currency display
- `src/hooks/useRetirementGoal.ts` - Shared goal calculation hook
- `src/lib/validation.ts` - Zod schemas for YAML import and form validation
