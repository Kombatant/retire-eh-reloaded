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

The application is 100% pure TypeScript (React + Vite). All financial compounding, Monte Carlo simulations, and retirement drawdown calculations are executed synchronously client-side in `src/lib/engine.ts` and `src/lib/projectionSim.ts`.

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

The app uses a horizontal tab layout with 4 sections:

| Tab | Purpose | Default |
|-----|---------|---------|
| Plan | Input: people, accounts, assumptions | Yes |
| Overview | Summary card, portfolio breakdown, income breakdown, goal progress | No |
| Projections | Growth charts, contribution split, Monte Carlo volatility, retirement drawdown | No |
| Learn | Educational content about methodology | No |

### Component Structure

```
App.tsx (provider shell)
├── PlanStoreProvider
│   └── ProjectionProvider
│       └── AppContent
│               ├── Header.tsx (logo, export/import, dark mode)
│               ├── Tabs.tsx (tab navigation)
│               ├── Tab Content (one active at a time)
│               │   ├── OverviewTab.tsx
│               │   │   ├── SummaryCard.tsx
│               │   │   ├── PortfolioCard.tsx
│               │   │   ├── IncomeBreakdownCard.tsx
│               │   │   ├── RetirementProjectionCard.tsx
│               │   │   └── GoalsCard.tsx
│               │   ├── PlanTab.tsx
│               │   │   ├── PersonSelector.tsx
│               │   │   ├── PersonForm.tsx
│               │   │   │   └── AccountCard.tsx
│               │   │   └── AssumptionsPanel.tsx
│               │   ├── ProjectionsTab.tsx
│               │   │   ├── GrowthChart.tsx
│               │   │   ├── ContributionGrowthChart.tsx
│               │   │   ├── MonteCarloChart.tsx
│               │   │   └── DrawdownChart.tsx
│               │   └── LearnTab.tsx
│               └── Footer.tsx (version display)
├── ErrorBoundary (shell-level)
└── ErrorBoundary (tab-level, wrapping tab content)
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

### Frontend (157 tests)
- `src/test/engine.test.ts` - Core calculation engine unit tests (projections, compounding, withdrawal)
- `src/test/cpp.test.ts` - CPP start-age adjustment factor and income-gating tests
- `src/test/tax.test.ts` - Quebec 2026 income tax, credits, OAS clawback, household tax allocation
- `src/test/people-context.test.tsx` - usePeople compatibility hook tests (CRUD, selection, import)
- `src/test/plan-migration.test.ts` - v1 → v2 migration, legacy localStorage, plan storage, plan edits
- `src/test/plan-store.test.tsx` - multi-plan store and persistence
- `src/test/app-smoke.test.tsx` - renders every tab; loads a v1-saved plan
- `src/test/validation.test.ts` - Zod validation tests
- `src/test/yaml-utils.test.ts` - YAML import/export tests
- `src/test/setup.test.ts` - Test harness verification

### Shared Utilities
- `src/lib/engine.ts` - Core deterministic retirement calculation engine
- `src/lib/projectionSim.ts` - Monte Carlo stochastic uncertainty simulation & drawdown
- `src/lib/tax.ts` - Quebec 2026 income tax estimator (brackets, credits, OAS clawback, household allocation)
- `src/lib/formatting.ts` - `formatMoney()`, `formatCompactMoney()` for all currency display
- `src/hooks/useRetirementGoal.ts` - Shared goal calculation hook
- `src/lib/validation.ts` - Zod schemas for YAML import and form validation
