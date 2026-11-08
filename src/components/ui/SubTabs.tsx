import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/lib/ui/cn'

export interface SubTab<T extends string> {
  value: T
  label: ReactNode
}

interface SubTabsProps<T extends string> {
  value: T
  onChange: (value: T) => void
  tabs: SubTab<T>[]
  ariaLabel: string
  // The panel content for the selected tab.
  children: ReactNode
  className?: string
}

// Switches between views inside one page so only one chart or table is
// shown at a time. Follows the WAI-ARIA tabs pattern (arrow keys, one tab stop).
export function SubTabs<T extends string>({ value, onChange, tabs, ariaLabel, children, className }: SubTabsProps<T>) {
  const base = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const tabId = (v: string) => `${base}-tab-${v}`

  const onKeyDown = (event: KeyboardEvent) => {
    const index = tabs.findIndex(t => t.value === value)
    let next = -1
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    if (next < 0) return
    event.preventDefault()
    onChange(tabs[next].value)
    requestAnimationFrame(() => document.getElementById(tabId(tabs[next].value))?.focus())
  }

  return (
    <div className={className}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        className="scrollbar-hide -mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-border px-1"
      >
        {tabs.map(tab => {
          const selected = tab.value === value
          return (
            <button
              key={tab.value}
              id={tabId(tab.value)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${base}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.value)}
              className={cn(
                '-mb-px min-h-[40px] whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors',
                selected ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
              )}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
      <div id={`${base}-panel`} role="tabpanel" aria-labelledby={tabId(value)}>
        {children}
      </div>
    </div>
  )
}
