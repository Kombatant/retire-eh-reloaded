import { useId, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/ui/cn'

// "More options" / "How to read this": content that most people can skip.
export function Disclosure({ label, children, defaultOpen = false, className }: {
  label: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(o => !o)}
        className="inline-flex min-h-[32px] items-center gap-1 text-[13px] font-medium text-fg-secondary hover:text-fg"
      >
        <ChevronDown className={cn('h-4 w-4 transition-transform', open ? 'rotate-0' : '-rotate-90')} aria-hidden />
        {label}
      </button>
      {open && <div id={id} className="mt-3">{children}</div>}
    </div>
  )
}
