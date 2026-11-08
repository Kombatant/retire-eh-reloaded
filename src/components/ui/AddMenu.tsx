import { Plus } from 'lucide-react'
import { DropdownMenu, type MenuItem } from './Floating'

// "+ Add …" button. With one option it adds directly; with several it opens a menu.
export function AddMenu({ label, items, onAdd }: {
  label: string
  items?: MenuItem[]
  onAdd?: () => void
}) {
  const className =
    'inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 text-[13px] font-medium text-fg ' +
    'shadow-[0_1px_2px_rgba(16,24,40,0.04)] hover:bg-surface-muted'

  if (!items || items.length === 0) {
    return (
      <button type="button" onClick={onAdd} className={className}>
        <Plus className="h-3.5 w-3.5" aria-hidden />
        {label}
      </button>
    )
  }

  return (
    <DropdownMenu
      label={<><Plus className="h-3.5 w-3.5" aria-hidden />{label}</>}
      items={items}
      buttonClassName={className}
    />
  )
}
