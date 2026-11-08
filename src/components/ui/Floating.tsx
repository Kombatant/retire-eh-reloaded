import { Fragment, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition } from './useAnchoredPosition'
import { usePortalContainer } from './portalContext'

// Menus and tooltips are rendered with fixed positioning in a portal, so no
// card's overflow or stacking context can clip them. Inside a modal sheet the
// portal targets the sheet's <dialog> instead, because a modal dialog makes
// the rest of the page inert.

export function FloatingPortal({ children }: { children: ReactNode }) {
  const container = usePortalContainer()
  if (typeof document === 'undefined') return null
  return createPortal(children, container ?? document.body)
}

export interface MenuItem {
  key: string
  label: ReactNode
  title?: string
  onSelect: () => void
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  // Shows a check mark (for "pick one" lists such as the plan switcher).
  checked?: boolean
  tone?: 'danger'
  disabled?: boolean
  // Draws a divider above this item.
  separator?: boolean
}

// A button that opens a list of actions (e.g. "+ Add income").
export function DropdownMenu({
  label,
  items,
  buttonClassName,
  buttonLabel,
  menuClassName = 'w-56',
  align = 'end',
}: {
  label: ReactNode
  items: MenuItem[]
  buttonClassName?: string
  // Accessible name, for triggers that only show an icon.
  buttonLabel?: string
  menuClassName?: string
  align?: 'start' | 'end'
}) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const position = useAnchoredPosition(open, buttonRef, menuRef, { prefer: 'below', align })

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
    if (open && position) menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [open, position])

  const onMenuKey = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
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
        aria-label={buttonLabel}
        title={buttonLabel}
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
            className={`z-[1000] overflow-y-auto p-1 bg-surface border border-border rounded-lg shadow-lg ${menuClassName}`}
          >
            {items.map(item => {
              const Icon = item.icon
              return (
                <Fragment key={item.key}>
                  {item.separator && <div role="separator" className="my-1 h-px bg-border" />}
                  <button
                    type="button"
                    role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
                    aria-checked={item.checked}
                    title={item.title}
                    disabled={item.disabled}
                    onClick={() => {
                      setOpen(false)
                      item.onSelect()
                    }}
                    className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] hover:bg-surface-muted focus:bg-surface-muted focus:outline-none disabled:opacity-40 disabled:pointer-events-none ${item.tone === 'danger' ? 'text-danger' : 'text-fg'}`}
                  >
                    {item.checked !== undefined && (
                      <Check className={`h-3.5 w-3.5 shrink-0 ${item.checked ? 'text-accent' : 'invisible'}`} aria-hidden />
                    )}
                    {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden />}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  </button>
                </Fragment>
              )
            })}
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
            className={`z-[1000] block max-w-[calc(100vw-16px)] px-3 py-2 text-[13px] leading-relaxed font-normal normal-case tracking-normal text-left text-fg-secondary bg-surface border border-border rounded-lg shadow-lg pointer-events-none ${className}`}
          >
            {content}
          </span>
        </FloatingPortal>
      )}
    </span>
  )
}
