import { useState } from 'react'
import { Copy, FilePlus2, Pencil, Trash2, Check } from 'lucide-react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { createDefaultPlan } from '@/lib/plan/defaults'

const iconButton = 'flex items-center justify-center h-10 w-10 rounded-lg border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:border-indigo-500 dark:hover:border-indigo-400 disabled:opacity-40'

// Choose, create, copy, rename and delete saved plans (scenarios).
export function PlanSwitcher() {
  const { plans, activePlan, selectPlan, addPlan, duplicatePlan, renamePlan, deletePlan, now } = usePlanStore()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const startRename = () => {
    setDraft(activePlan.name)
    setEditing(true)
  }
  const commitRename = () => {
    const name = draft.trim()
    if (name) renamePlan(activePlan.id, name)
    setEditing(false)
  }

  return (
    <div className="flex items-center gap-2">
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename()
            if (e.key === 'Escape') setEditing(false)
          }}
          onBlur={commitRename}
          className="h-10 w-44 px-3 text-sm rounded-lg border-2 border-indigo-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          aria-label="Plan name"
        />
      ) : (
        <select
          value={activePlan.id}
          onChange={(e) => selectPlan(e.target.value)}
          className="h-10 max-w-[12rem] px-3 text-sm font-medium rounded-lg border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
          aria-label="Active plan"
          title="Switch plan"
        >
          {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}
      {editing ? (
        <button onMouseDown={(e) => e.preventDefault()} onClick={commitRename} className={iconButton} title="Save name" aria-label="Save plan name">
          <Check className="w-4 h-4" />
        </button>
      ) : (
        <button onClick={startRename} className={iconButton} title="Rename plan" aria-label="Rename plan">
          <Pencil className="w-4 h-4" />
        </button>
      )}
      <button onClick={() => duplicatePlan(activePlan.id)} className={iconButton} title="Duplicate plan (try a what-if)" aria-label="Duplicate plan">
        <Copy className="w-4 h-4" />
      </button>
      <button onClick={() => addPlan(createDefaultPlan(now, `Plan ${plans.length + 1}`))} className={iconButton} title="New plan" aria-label="New plan">
        <FilePlus2 className="w-4 h-4" />
      </button>
      <button
        onClick={() => {
          if (window.confirm(`Delete "${activePlan.name}"? This cannot be undone.`)) deletePlan(activePlan.id)
        }}
        disabled={plans.length <= 1}
        className={iconButton}
        title="Delete plan"
        aria-label="Delete plan"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  )
}
