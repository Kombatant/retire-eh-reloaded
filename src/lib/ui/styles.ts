// Class strings shared by several UI primitives. They live here, not in a
// component file, so component modules only export components (fast refresh).

export const controlBase =
  'block w-full min-w-0 rounded-md border border-border-strong bg-surface text-sm text-fg ' +
  'placeholder:text-fg-muted shadow-[0_1px_1px_rgba(16,24,40,0.03)] ' +
  'focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 ' +
  'disabled:opacity-60 disabled:cursor-not-allowed'

export const controlSize = {
  sm: 'h-8 px-2.5',
  md: 'h-10 px-3',
} as const

export type ControlSize = keyof typeof controlSize

export const labelClass = 'block text-[13px] font-medium text-fg-secondary'

export const hintClass = 'text-xs text-fg-muted'

// Data tables: quiet header, hairline rows, right-aligned figures.
export const table = {
  wrap: 'overflow-auto rounded-lg border border-border',
  table: 'w-full border-collapse text-[13px]',
  thead: 'sticky top-0 z-10 bg-surface-muted text-xs text-fg-muted',
  th: 'whitespace-nowrap px-3 py-2 text-right font-medium first:text-left',
  tr: 'border-t border-border text-fg-secondary',
  td: 'whitespace-nowrap px-3 py-2 text-right first:text-left',
  tfoot: 'border-t border-border-strong bg-surface-muted font-medium text-fg',
} as const
