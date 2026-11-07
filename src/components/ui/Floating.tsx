import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition } from './useAnchoredPosition'

// Menus and tooltips are rendered into document.body with fixed positioning.
// Cards use backdrop-filter (and a hover transform), which makes each card
// its own stacking context: anything absolutely positioned inside a card,
// whatever its z-index, is painted under the next card. A portal escapes that.

export function FloatingPortal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null
  return createPortal(children, document.body)
}

export interface MenuItem {
  key: string
  label: string
  title?: string
  onSelect: () => void
}

// A button that opens a list of actions (e.g. "+ Add income").
export function DropdownMenu({
  label,
  items,
  buttonClassName,
  menuClassName = 'w-56',
}: {
  label: ReactNode
  items: MenuItem[]
  buttonClassName?: string
  menuClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const position = useAnchoredPosition(open, buttonRef, menuRef, { prefer: 'below', align: 'end' })

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    // A fixed menu would drift away from its button when the page scrolls.
    const onScroll = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  // Move focus into the menu for keyboard users.
  useEffect(() => {
    if (open && position) menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
  }, [open, position])

  const onMenuKey = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next]?.focus()
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className={buttonClassName}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
      </button>
      {open && (
        <FloatingPortal>
          <div
            ref={menuRef}
            role="menu"
            onKeyDown={onMenuKey}
            style={{
              position: 'fixed',
              top: position?.top ?? -9999,
              left: position?.left ?? -9999,
              maxHeight: position?.maxHeight,
              visibility: position ? 'visible' : 'hidden',
            }}
            className={`z-[1000] overflow-y-auto py-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg ${menuClassName}`}
          >
            {items.map(item => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                title={item.title}
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
                className="w-full px-3 py-2 text-left text-xs text-gray-700 dark:text-gray-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 focus:bg-indigo-50 dark:focus:bg-indigo-900/30 focus:outline-none"
              >
                {item.label}
              </button>
            ))}
          </div>
        </FloatingPortal>
      )}
    </>
  )
}

// Hover/focus tooltip rendered above everything else.
export function Tooltip({
  content,
  children,
  className = 'w-64',
  prefer = 'above',
  align = 'center',
}: {
  content: ReactNode
  children: ReactNode
  className?: string
  prefer?: 'above' | 'below'
  align?: 'start' | 'center' | 'end'
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const tipRef = useRef<HTMLSpanElement>(null)
  const position = useAnchoredPosition(open, anchorRef, tipRef, { prefer, align })

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('scroll', close, true)
    return () => window.removeEventListener('scroll', close, true)
  }, [open])

  return (
    <span
      ref={anchorRef}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <FloatingPortal>
          <span
            ref={tipRef}
            role="tooltip"
            style={{
              position: 'fixed',
              top: position?.top ?? -9999,
              left: position?.left ?? -9999,
              visibility: position ? 'visible' : 'hidden',
            }}
            className={`z-[1000] block max-w-[calc(100vw-16px)] px-3 py-2 text-sm font-normal normal-case tracking-normal text-left text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg pointer-events-none ${className}`}
          >
            {content}
          </span>
        </FloatingPortal>
      )}
    </span>
  )
}
