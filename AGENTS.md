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

### Tab Navigation

The app uses a horizontal tab layout with 8 sections:

| Tab | Purpose | Default |
|-----|---------|---------|
| Plan | Inputs: people, accounts, income, spending, real estate & debts, drawdown, assumptions | Yes |
| Overview | Summary, portfolio, income breakdown, goal progress, tax detail, milestones, estate | No |
| Projections | Growth charts, contribution split, retirement drawdown, benefit timing | No |
| Cash Flow | Yearly Sankey, tax by year, bracket room, year-by-year table with CSV export | No |
| Risk | Monte Carlo fan chart and success rate, historical backtest, stress tests | No |
| Compare | 2–3 saved plans side by side | No |
| Tracking | Dated balance snapshots, actual vs. projected, rebaseline | No |
| Learn | Educational content about methodology | No |

The header has a plan switcher: new, duplicate, rename and delete.

### Component Structure

```
App.tsx (provider shell)
├── PlanStoreProvider
│   └── ProjectionProvider
│       └── AppContent
│           ├── Header.tsx (logo, PlanSwitcher, export/import/share, dollars toggle, dark mode)
│           ├── Tabs.tsx
│           ├── Tab content (one active at a time, inside an ErrorBoundary)
│           │   ├── PlanTab.tsx
│           │   │   ├── PersonSelector / PersonForm
│           │   │   │   ├── PersonDetails (province, horizon, OAS residency, CPP, room)
│           │   │   │   └── AccountsSection (all account types)
│           │   │   ├── IncomePanel, AssumptionsPanel, SpendingPanel
│           │   │   └── RealEstatePanel, DrawdownPanel
│           │   ├── OverviewTab.tsx (Summary, Portfolio, Goals, RetirementTaxTable, MilestonesCard, EstateCard, …)
│           │   ├── ProjectionsTab.tsx (Growth, ContributionGrowth, Drawdown, RetirementCashFlowTable, BenefitTiming)
│           │   ├── CashFlowTab.tsx, RiskTab.tsx, CompareTab.tsx, TrackingTab.tsx
│           │   └── LearnTab.tsx
│           └── Footer.tsx
```

### State Management

- The plan data model is versioned (`src/lib/plan/schema.ts`, zod, `schemaVersion: 2`). It is the single source of truth for persistence, YAML export and share links.
- Every external plan source (YAML, share links, stored plans) goes through `parsePlanData` in `src/lib/plan/migrate.ts`. Older v1 files are migrated forward there.
- `PlanStoreProvider` (`src/contexts/PlanStoreContext.tsx`) owns all saved plans, the active plan id, UI preferences and person selection, via `useReducer`.
  - It persists everything under one localStorage key, `retireEh.v2`.
  - On first load it migrates the original loose keys.
- `usePeople` and `useAssumptions` are compatibility hooks. They present v1-shaped data (`src/lib/plan/legacy-view.ts`) and map edits onto pure v2 transforms (`src/lib/plan/edits.ts`).
- New UI should use `usePlanStore()` directly.
- `ProjectionProvider` derives projection data from the active plan.
- `App.tsx` is a thin layout shell that nests providers.
- Active tab state lives in `AppContent`.

### Mobile Responsiveness

- Tabs scroll horizontally on mobile
- Tab bar is sticky at top
- Touch-friendly hit areas (min 44px height)

## Testing

### Frontend tests (`npm test`)
- `plan-migration`, `plan-store`, `people-context`, `yaml-utils`, `share-link`, `validation`: data model, v1 → v2 migration, storage, import/export.
- `sim-parity`: the unified engine with v1 rules matches the original engine within $1. `engine`, `retirement-cash-flow`, `tax`, `cpp`, `oas*` cover the original modules.
- `tax-provinces`: hand-computed golden tax values, every jurisdiction, payroll, splitting, OAS/GIS/CPP.
- `sim-v2`, `sim-accounts`, `sim-spending`, `sim-drawdown`: engine behaviour (tax ownership, refunds, account types, room, income streams, budgets, real estate, RRIF/LIF, strategies, survivors, estate).
- `sim-risk`, `rng`: Monte Carlo, backtest, crash scenarios.
- `insights`: Sankey, CSV, FI metrics, milestones, comparison, brackets.
- `cpp-history`: CPP/QPP estimate from work history.
- `sim-stocks`, `stock-quotes`: stock holdings, RSU/ESPP, sell plans, scenarios, quote providers (mocked fetch).
- `projection-consistency`, `narrative`, `app-smoke` (renders every tab).

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
- `src/lib/formatting.ts` - `formatMoney()`, `formatCompactMoney()` for all currency display
- `src/hooks/useRetirementGoal.ts` - Shared goal calculation hook
- `src/lib/validation.ts` - Zod schemas for YAML import and form validation
