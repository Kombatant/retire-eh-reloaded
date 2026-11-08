import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Callout } from '@/components/ui/Callout'
import { Field } from '@/components/ui/Field'
import { TextInput } from '@/components/ui/inputs'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Sheet } from '@/components/ui/Sheet'
import { isPlanNameTaken, suggestPlanName } from '@/lib/plan/names'
import type { PlanV2 } from '@/lib/plan/schema'
import type { ImportedPlan } from '@/lib/yaml-utils'

export type ImportMode = 'new' | 'replace'

interface ImportPlanSheetProps {
  imported: ImportedPlan | null
  plans: PlanV2[]
  activePlan: PlanV2
  onCancel: () => void
  onConfirm: (mode: ImportMode, name: string) => void
}

export function ImportPlanSheet({ imported, plans, activePlan, onCancel, onConfirm }: ImportPlanSheetProps) {
  return (
    <Sheet open={!!imported} onClose={onCancel} title="Import plan" description={imported ? `From file: ${imported.plan.name}` : undefined}>
      {imported && (
        <ImportPlanForm
          importedName={imported.plan.name.trim() || 'Imported plan'}
          plans={plans}
          activePlan={activePlan}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      )}
    </Sheet>
  )
}

function ImportPlanForm({ importedName, plans, activePlan, onCancel, onConfirm }: Omit<ImportPlanSheetProps, 'imported'> & { importedName: string }) {
  // Starts on the choice that cannot lose data.
  const [mode, setMode] = useState<ImportMode>('new')
  const [typedName, setTypedName] = useState<string | null>(null)

  // A replacement gives up the open plan's name, so only the others can clash.
  const otherPlans = mode === 'replace' ? plans.filter(plan => plan.id !== activePlan.id) : plans
  const needsName = isPlanNameTaken(importedName, otherPlans)
  const name = needsName ? typedName ?? suggestPlanName(importedName, otherPlans) : importedName
  const nameError = !needsName ? undefined
    : !name.trim() ? 'Enter a name.'
      : isPlanNameTaken(name, otherPlans) ? `You already have a plan called "${name.trim()}".`
        : undefined

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!nameError) onConfirm(mode, name.trim())
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <SegmentedControl
        ariaLabel="How to import"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'new', label: 'New plan' },
          { value: 'replace', label: 'Replace open plan' },
        ]}
      />
      {mode === 'new' ? (
        <p className="text-sm text-fg-secondary">Adds it to your saved plans and opens it. “{activePlan.name}” stays as it is.</p>
      ) : (
        <Callout tone="warning" title={`This overwrites “${activePlan.name}”`}>
          Its current numbers are replaced and cannot be restored.
        </Callout>
      )}
      {needsName && (
        <Field label="Plan name" hint={`You already have a plan called “${importedName}”.`} error={nameError}>
          <TextInput value={name} onChange={(e) => setTypedName(e.target.value)} />
        </Field>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={!!nameError}>
          {mode === 'new' ? 'Add plan' : 'Replace plan'}
        </Button>
      </div>
    </form>
  )
}
