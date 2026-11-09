import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/lib/ui/cn'

export interface SegmentOption<T extends string> {
  value: T
  label: ReactNode
  title?: string
}

interface SegmentedControlProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: SegmentOption<T>[]
  ariaLabel: string
  size?: 'sm' | 'md'
  // Stretch to the container with equal segments, e.g. to line up with table columns.
  fill?: boolean
  className?: string
}

// A small set of mutually exclusive choices shown side by side.
// Behaves as a radio group: one tab stop, arrow keys move the selection.
export function SegmentedControl<T extends string>({
  value, onChange, options, ariaLabel, size = 'md', fill, className,
}: SegmentedControlProps<T>) {
  const groupRef = useRef<HTMLDivElement>(null)

  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const index = options.findIndex(o => o.value === value)
    const next = options[(index + step + options.length) % options.length]
    onChange(next.value)
    requestAnimationFrame(() => {
      groupRef.current?.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus()
    })
  }

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn(fill ? 'flex w-full' : 'inline-flex max-w-full', 'rounded-lg bg-surface-muted p-0.5 ring-1 ring-inset ring-border', className)}
    >
      {options.map(option => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            data-value={option.value}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              'whitespace-nowrap rounded-md font-medium transition-colors',
              fill && 'min-w-0 flex-1 basis-0',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]',
              selected
                ? 'bg-surface text-fg shadow-[0_1px_2px_rgba(16,24,40,0.1)] ring-1 ring-border'
                : 'text-fg-muted hover:text-fg',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
