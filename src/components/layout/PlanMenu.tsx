import { useState } from 'react'
import { ChevronsUpDown, Copy, FilePlus2, Pencil, Trash2 } from 'lucide-react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { createDefaultPlan } from '@/lib/plan/defaults'
import { DropdownMenu, type MenuItem } from '@/components/ui/Floating'

// The active plan and everything you can do with saved plans, in one menu.
export function PlanMenu() {
  const { plans, activePlan, selectPlan, addPlan, duplicatePlan, renamePlan, deletePlan, now } = usePlanStore()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const commitRename = () => {
    const name = draft.trim()
    if (name) renamePlan(activePlan.id, name)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitRename()
          if (e.key === 'Escape') setEditing(false)
        }}
        onBlur={commitRename}
        className="h-8 w-44 rounded-md border border-accent bg-surface px-2.5 text-sm text-fg ring-2 ring-accent/20 focus:outline-none"
        aria-label="Plan name"
      />
    )
  }

  const items: MenuItem[] = [
    ...plans.map(plan => ({
      key: plan.id,
      label: plan.name,
      checked: plan.id === activePlan.id,
      onSelect: () => selectPlan(plan.id),
    })),
    {
      key: 'new', label: 'New plan', icon: FilePlus2, separator: true,
      onSelect: () => addPlan(createDefaultPlan(now, `Plan ${plans.length + 1}`)),
    },
    {
      key: 'duplicate', label: 'Duplicate this plan', icon: Copy, title: 'Make a copy to try a what-if',
      onSelect: () => duplicatePlan(activePlan.id),
    },
    {
      key: 'rename', label: 'Rename…', icon: Pencil,
      onSelect: () => {
        setDraft(activePlan.name)
        setEditing(true)
      },
    },
    {
      key: 'delete', label: 'Delete plan', icon: Trash2, tone: 'danger', disabled: plans.length <= 1,
      title: plans.length <= 1 ? 'You need at least one plan' : undefined,
      onSelect: () => {
        if (window.confirm(`Delete "${activePlan.name}"? This cannot be undone.`)) deletePlan(activePlan.id)
      },
    },
  ]

  return (
    <DropdownMenu
      align="start"
      menuClassName="w-64"
      items={items}
      buttonClassName="inline-flex h-8 max-w-[11rem] items-center gap-1.5 rounded-md px-2 text-sm font-medium text-fg hover:bg-surface-muted sm:max-w-[16rem]"
      label={
        <>
          <span className="sr-only">Active plan: </span>
          <span className="truncate">{activePlan.name}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden />
        </>
      }
    />
  )
}
