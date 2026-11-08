import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, Info, X } from 'lucide-react'

type ToastTone = 'success' | 'info'

interface Toast {
  id: number
  message: string
  tone: ToastTone
}

interface ToastContextValue {
  notify: (message: string, tone?: ToastTone) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const DISMISS_AFTER_MS = 5000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts(list => list.filter(t => t.id !== id))
  }, [])

  const notify = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = nextId.current++
    setToasts(list => [...list.slice(-2), { id, message, tone }])
  }, [])

  const value = useMemo(() => ({ notify }), [notify])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[1100] flex flex-col items-center gap-2 px-4 sm:items-end sm:right-4 sm:left-auto"
      >
        {toasts.map(toast => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), DISMISS_AFTER_MS)
    return () => clearTimeout(timer)
  }, [toast.id, onDismiss])

  const Icon = toast.tone === 'success' ? CheckCircle2 : Info
  return (
    <div
      role="status"
      className="pointer-events-auto animate-fade-in flex w-full max-w-sm items-start gap-2.5 rounded-lg border border-border bg-surface px-3.5 py-3 text-sm text-fg shadow-lg"
    >
      <Icon className={toast.tone === 'success' ? 'mt-0.5 h-4 w-4 shrink-0 text-success' : 'mt-0.5 h-4 w-4 shrink-0 text-accent'} aria-hidden />
      <span className="flex-1">{toast.message}</span>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="-m-1 rounded p-1 text-fg-muted hover:text-fg"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside ToastProvider')
  return context
}
