import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { IconButton } from './Button'
import { PortalContainerContext } from './portalContext'

interface SheetProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  side?: 'right' | 'left'
  // 'lg' for editors with wide rows (stock holdings).
  size?: 'md' | 'lg'
}

// A side panel for editing one item in full (an account, an income stream…).
// Built on a native modal <dialog>, which gives focus trapping, Escape to
// close and an inert page behind it without extra code.
export function Sheet({ open, onClose, title, description, children, footer, side = 'right', size = 'md' }: SheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const titleId = useId()
  const setDialog = useCallback((node: HTMLDialogElement | null) => {
    dialogRef.current = node
    setContainer(node)
  }, [])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
  }, [open])

  return (
    <dialog
      ref={setDialog}
      className="sheet animate-sheet-in"
      data-side={side}
      data-size={size}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {open && (
        <PortalContainerContext.Provider value={container}>
          <div className="flex h-full flex-col">
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div className="min-w-0">
                <h2 id={titleId} className="text-base font-semibold text-fg">{title}</h2>
                {description && <p className="mt-0.5 text-[13px] text-fg-muted">{description}</p>}
              </div>
              <IconButton icon={X} label="Close" size="sm" onClick={onClose} className="-mr-1.5" />
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
            {footer && <div className="border-t border-border px-5 py-3">{footer}</div>}
          </div>
        </PortalContainerContext.Provider>
      )}
    </dialog>
  )
}
