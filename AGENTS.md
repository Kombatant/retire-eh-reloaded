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
  - One-time costs paid from savings (gifts, debt left after a sale, a replacement home) go through `fundOneOff`, so they are withdrawn, taxed and reported like any other withdrawal.
  - A property sold from retirement onwards isn't in savings at retirement, so `YearRow.propertySaleCredit` carries it into the goal, discounted at the withdrawal rate (`valueAtRetirement`). The verdict still needs the simulation to stay funded.
  - `YearRow.shortfall` decides whether a year counts as funded: unfunded budget for `expenses`/`initialPct`, unfunded essentials for strategies that flex spending. In simple mode: the income target minus simulated income for fixed rates and `expenses`, the missed withdrawal for flexible strategies. `budgetShortfall`, `essentialShortfall` and `withdrawalShortfall` report each part.
  - `evaluateFunding` (`funding.ts`) is the one verdict: every page reads it, with a $1 real tolerance. It reports the first shortfall, cause and depletion separately. The savings goal is a labelled guideline and never decides on-track. Bump `MODEL_VERSION` there when results change.
  - Money can't appear or vanish: `src/test/invariants.test.ts` checks every row reconciles. Detailed mode saves only from cash left after tax and spending (the share is solved, because the deduction feeds back into tax; `missedContributions` reports the rest), and debt follows what was actually paid. Simple-mode saving comes from outside the model, and it invests receipts net of the year's tax on them.
  - The first period runs from `plan.asOf` to the next January 1 (`firstPeriodFraction`, `YearRow.periodFraction`). Recurring flows are prorated, one-time events are not, paths own the return (`planPath`, `scaleFirstPeriod`, `lognormalReturn`'s `period`), and tax is T(R+O) − (1−f)·T(R) inside `householdTax`. Headline figures use `c.headlineOffset`. Build deterministic paths with `planPath(c)`.
  - RRSP room is always ledgered: an untracked person is capped at an estimate from new room. Excess contributions go to `excessAccount` (non-registered, undeducted) and are reported as `excessContributions`.
  - Year-specific tax rules are data on each province (`indexPauses`, `basicPersonalSteps`, `pensionIndexed`), turned into yearly real values by `src/lib/tax/indexation.ts`.
  - `legacyAdapter.ts` turns the output into the series the existing charts use.
  - Deterministic projections, scenario bands and (later) Monte Carlo and backtests all reuse `simulate`.
- **Risk** (`src/lib/sim/risk.ts`, `paths/`): Monte Carlo (correlated lognormal asset returns plus AR(1) inflation, seeded), historical backtest over `src/data/historical/canada-annual.json`, and crash overlays. All run on `simulate`.
  - Return inputs are long-run compounded rates. `monteCarloPath` converts them to arithmetic means with `arithmeticFromCompounded`, so a typical run compounds at the rate entered.
  - The Risk tab runs them in a Web Worker (`src/workers/sim.worker.ts`) through `useRiskAnalysis`.
  - Results stream in batches and are cached by plan.
  - `paths/historical.ts` also replays from the first retirement year (`retirementAnchoredPath`); stress tests add longevity cases; `successRange` is a Wilson interval on the success rate.
  - `failures.ts` keeps a small record per run (`analyzeRun`) and turns it into a `FailureSummary`: when the failing runs first fall short, for how long, by how much, why money was left over if it was, and how their markets differed from the funded runs. Only Risk asks for records (`acc.records`), so Proposals doesn't pay for them. `src/lib/insights/failureExplanation.ts` turns the summary into words and picks the fixes shown on the Risk page from the Proposals job.
  - In tests, where jsdom has no Worker, a small sample runs synchronously instead.
- **Insights** (`src/lib/insights/`): Sankey data, CSV export, FI and Coast FI, milestones, plan comparison, tax-bracket position, the per-year account breakdown (balances and withdrawals by account category, `accountBreakdown.ts`) and spending levels (savings at yearly amounts around the plan's spending, each a full `simulate` run with withdrawals following spending, `spendingLevels.ts`). Each is a pure, tested helper.
- **Proposals** (`src/lib/insights/proposals.ts`): each candidate is a serializable `Change`, applied with `applyChanges` and scored by re-running `simulate` and Monte Carlo on the same seeds as the baseline. A change is shown only if it beats the plan by a meaningful margin (`isImprovement`).
  - The page runs `runProposalJob` in its own Web Worker (`src/workers/proposals.worker.ts`) through `useProposals`.
  - Add a new lever by adding a `Change` kind, its `applyChange` and `describeChange` cases, and a candidate list.
  - When a plan misses the goal or the success target, the trade-offs include downsizing or selling the principal residence, from the latest age to the earliest (`homeSaleLevers`). Selling outright adds an estimated rent to the budget, so it is only offered in detailed mode.
  - The verdict and guideline come from `planGoalOutlook` (`src/lib/insights/outlook.ts`), which the Dashboard also uses through `usePlanOutlook`, so both give the same answer.
  - Retirement timing (`src/lib/insights/retirementTiming.ts`) scores a range of retirement ages the same way, in its own worker through `useRetirementTiming`. All ages are scored up front so the slider needs no recalculation. "Safe" means the success target and the funding verdict are both met, at that age and every later age tested.
- **Original engine** (`src/lib/legacy/`): kept only as the reference for `src/test/sim-parity.test.ts`.

## GitHub Actions

### CI Pipeline (`.github/workflows/ci.yml`)
- Runs on push/PR to `main` and `develop` branches
- Checks: Type check, lint, vitest tests, production build

### Docker Image (`.github/workflows/docker.yml`)
- Runs on push to `main` and on version tags
- Builds the `Dockerfile` (Node build, nginx serving `docker/nginx.conf`) and pushes `ghcr.io/kombatant/retire-eh-reloaded` (`latest`, semver, short SHA)
- Self-hosted with `docker-compose.yml` (e.g. on Unraid). There is no GitHub Pages deployment.

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
| | Projections | `#/projections/<growth\|drawdown\|benefits\|stocks>` | Saving years (savings by account), retirement years (where the money comes from each year, savings by account, spending in dollars or withdrawal rates, estate), CPP/OAS timing, stock scenarios (Advanced) |
| | Cash flow | `#/cashflow/<flow\|table>` | Yearly Sankey, year-by-year table with column presets and CSV export |
| | Taxes | `#/taxes/<retirement\|by-year\|brackets>` | Tax at retirement, tax by year, bracket room |
| | Risk | `#/risk/<monte-carlo\|historical\|stress>` | Success KPIs; fan chart, historical backtest, stress tests; how the failing runs fail and what would fix them |
| | Proposals | `#/proposals` | When it's safest to retire, with a slider to try other ages; changes tested against the current plan: best combination, free changes, trade-offs or room to spare; try as a new plan or apply with undo |
| Tools | Compare | `#/compare` | 2–3 saved plans side by side |
| | Tracking | `#/tracking` | Dated balance snapshots, actual vs. projected by day, rebaseline |
| — | Learn | `#/learn/<topic>` | Methodology articles |

Share links also use the hash (`#plan=…`). Route hashes always start with `#/`, so `parseRoute` ignores share hashes (`src/lib/ui/route.ts`).

The top bar has the plan menu (switch, new, duplicate, rename, delete), the Today's $ / Future $ switch, Share and a ⋯ menu (export/import YAML; an import asks whether to add a new plan or replace the open one, and asks for a name only if it would clash). The sidebar footer has the Advanced mode switch, the theme control (light/dark/system) and the version.

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
- Don't tighten `planSchema` for things the engine merely can't honour: a schema failure stops a plan loading or saving. Report them from `diagnosePlan` (`src/lib/plan/diagnostics.ts`) instead.
- Stored data that can't be read is copied untouched to `retireEh.v2.recovery` before anything overwrites it (`loadStoreWithRecovery`, `preserveRecovery`). Snapshots and baselines are parsed entry by entry. Blocked storage gives an explicit unsaved session (`unavailable`).
- Share links and YAML imports are limited to 128 KiB encoded and 2 MiB decoded, enforced during inflation (`share-link.ts`, `MAX_IMPORT_BYTES`).
- Results that arrive later (quotes) use `updatePlan(id, …)`, so they reach the plan that asked for them.
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
- `plan-migration`, `plan-store`, `plan-import`, `people-context`, `yaml-utils`, `share-link`, `validation`: data model, v1 → v2 migration, storage, import/export.
- `sim-parity`: the unified engine with v1 rules matches the original engine within $1. `engine`, `retirement-cash-flow`, `tax`, `cpp`, `oas*` cover the original modules.
- `tax-provinces`: hand-computed golden tax values, every jurisdiction, payroll, splitting, OAS/GIS/CPP.
- `sim-v2`, `sim-accounts`, `sim-spending`, `sim-drawdown`: engine behaviour (tax ownership, refunds, account types, room, income streams, budgets, real estate, RRIF/LIF, strategies, survivors, estate).
- `sim-risk`, `rng`: Monte Carlo, backtest, crash scenarios, how failing runs fail.
- `audit-regressions`: scenarios the engine once got wrong (funding verdicts, cash conservation, tax order, year-specific rules, LIF tables, room, losses, final return, partial first year, tracking, storage recovery, import limits, plan diagnostics).
- `invariants`: every row reconciles balances and cash, across a scenario matrix.
- `quote-refresh`: one refresh at a time, queued per plan.
- `insights`, `outlook`: Sankey, CSV, FI metrics, milestones, comparison, brackets; goal outlook, income sources, money-lasts.
- `spending-levels`: the yearly amounts compared, that a level matches changing the budget, and the most a plan can spend.
- `proposals`: applying changes, which proposals are offered, and that a proposal's numbers match applying it.
- `retirement-timing`: the range of ages tested, the earliest safe age, and that a tested age's numbers match applying it.
- `cpp-history`: CPP/QPP estimate from work history.
- `sim-stocks`, `stock-quotes`: stock holdings, RSU/ESPP, sell plans, scenarios, quote providers (mocked fetch).
- `route`, `advanced-settings`, `ui-primitives`: hash routes, Essentials/Advanced detection, Sheet/SegmentedControl/SubTabs/NumberInput/Field.
- `projection-consistency`, `narrative`, `app-smoke`: every page and Plan section renders; deep links; Advanced mode; theme; shared-plan flow.

### Shared Utilities
- `src/lib/sim/` - Unified year-by-year simulation engine (`steps/`: debts, solver, RRIF/LIF, spending strategies)
- `src/lib/sim/risk.ts` - Monte Carlo, historical backtest and stress tests on the unified engine
- `src/lib/tax/`:
  - `data/2026.ts`: 2026 tables for federal and all 13 jurisdictions. `data/SOURCES.md` lists each table's source and status, and the yearly update checklist.
  - `personal.ts`: income tax for one person.
  - `household.ts`: pension income splitting.
  - `payroll.ts`: CPP/QPP/EI.
  - `quebecLegacy.ts`: the original v1 estimator.
- `src/lib/benefits/`: CPP/QPP estimate and survivor pension, OAS (residency, deferral, +10% at 75), GIS and the Allowances. GIS reads break points from the published tables and last year's income, which the engine keeps per person.
- Quebec has its own rules in `household.ts`: one age and retirement amount per couple, reduced on family income and claimable by either spouse (Schedule B), a pension split with its own age test, searched separately from the federal one (Schedule Q), and unused credits moving between two Quebec spouses (line 431). The health services fund (Schedule F) is in `personal.ts`.
- Couples also share unused age and pension amounts (Schedule 2) and one low-income reduction in NL, PE, NS and NB (`household.ts`).
- Household tax (`household.ts`) gives the spouse amount to the higher earner and limits a receiver under 65 to pension-plan income for the pension credit. FHSAs end by `fhsa.closureYear` and roll into the RRSP; a `homePurchaseYear` takes the balance out tax-free.
- `src/lib/market/quotes.ts`: live stock quotes, fetched from the browser.
  - Providers: Twelve Data or Alpha Vantage, with the user's free API key.
  - USD→CAD conversion uses the Bank of Canada Valet API.
  - The key is stored in localStorage (`retireEh.marketData`) and never in the plan, so it isn't exported or shared.
  - `useAutoRefreshQuotes` (in App) refreshes stale prices once a day.
- Stock portfolio accounts (`type: 'STOCK'`): holdings with vested shares, unvested RSU tranches, ESPP, a bear/base/bull/custom price projection (custom follows base until set), and a sell plan.
  - The share price (`priceUsd`) is always in USD, converted at the plan's `assumptions.usdCad.rate` (Bank of Canada, held constant in projections). Every other amount, including the cost per share, is CAD. Older plans that stored a CAD `price` are converted in `parsePlanData`.
  - Vesting and the ESPP benefit are taxed as employment income. With `sellToCover` (default on), the extra tax and payroll a vest causes are paid by selling the new shares at vest (no gain); the row reports it as `stockTaxWithheld`, and it is still part of `tax`.
  - `src/lib/insights/stockScenarios.ts` compares the three cases with and without the sell plan.
- Yearly bonuses are income kinds. `bonus` (cash) is employment income, kept apart from `employment` so it stays out of the primary salary (CPP estimate, replacement target). `rsu` is a typical CAD value per year: that year's projected price for the chosen holding gives the share count, it is taxed as stock compensation, and `row.rsuAwards` reports shares before and after sell to cover. With no holding, the value goes to a non-registered account.
- `src/lib/formatting.ts` - `money()` / `moneyCompact()` (with `$`) and `formatMoney()` / `formatCompactMoney()` (digits only) for all currency display
- `src/lib/validation.ts` - Zod schemas for YAML import and form validation
