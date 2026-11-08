// Chart colours and shared chart props.
//
// Colours are CSS variables (defined in index.css), which recharts passes
// straight to SVG `fill`/`stroke`. Charts therefore follow light/dark mode
// without re-rendering and without reading the theme.
//
// Each colour has one meaning across the whole app: an RRSP is always the
// same blue, CPP always the same aqua. Categories that are drawn next to each
// other (stacked accounts, income sources) take their slots in palette order,
// which is what keeps them distinguishable for colour-blind readers.

const series = (n: number) => `var(--series-${n})`

export const chartColors = {
  // Account groups, in stacking order.
  registered: series(1),
  tfsa: series(3),
  nonRegistered: series(4),
  fhsa: series(7),
  stock: series(2),

  // Retirement income sources, in stacking order.
  withdrawals: series(1),
  cpp: series(3),
  oas: series(4),
  gis: series(5),
  pension: series(7),
  employment: series(2),
  other: 'var(--fg-muted)',

  // Cash-flow roles.
  income: series(1),
  tax: series(2),
  savings: series(7),
  spending: series(3),

  // Growth decomposition.
  contributions: series(3),
  growth: series(1),

  // Scenarios.
  bear: series(2),
  base: series(1),
  bull: series(3),

  // Totals and reference lines are ink, not a hue, so they never
  // compete with a category for identity.
  total: 'var(--fg)',
  reference: 'var(--fg-muted)',

  // Status, for pass/fail marks. Always paired with a label or icon.
  good: 'var(--success)',
  bad: 'var(--danger)',
  warn: 'var(--warning)',

  grid: 'var(--chart-grid)',
  axis: 'var(--chart-axis)',
  surface: 'var(--surface)',
} as const

// Ordered values (light → dark), e.g. increasing withdrawal rates.
export const sequentialColors = [1, 2, 3, 4, 5].map(n => `var(--seq-${n})`)

// Plans in Compare, and any other "identity only" multi-series chart.
// The first three slots stay apart even when every pair is on screen at once.
export const seriesOrder = [series(1), series(2), series(3), series(4), series(5), series(6), series(7), series(8)]

export const axisProps = {
  stroke: chartColors.axis,
  tick: { fill: chartColors.axis, fontSize: 12 },
  tickLine: false,
  axisLine: { stroke: chartColors.grid },
} as const

export const gridProps = {
  stroke: chartColors.grid,
  strokeDasharray: '0',
  vertical: false,
} as const

export const tooltipProps = {
  contentStyle: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    boxShadow: '0 4px 12px rgba(16, 24, 40, 0.08)',
    color: 'var(--fg)',
    fontSize: 12,
    padding: '8px 10px',
  },
  labelStyle: { color: 'var(--fg)', fontWeight: 600, marginBottom: 4 },
  itemStyle: { color: 'var(--fg-secondary)', padding: 0 },
  cursor: { stroke: 'var(--border-strong)', strokeWidth: 1 },
} as const

export const barTooltipProps = {
  ...tooltipProps,
  cursor: { fill: 'var(--surface-muted)' },
} as const

export const legendProps = {
  iconType: 'circle',
  iconSize: 8,
  wrapperStyle: { fontSize: 12, color: 'var(--fg-secondary)', paddingTop: 8 },
} as const
