import yaml from 'js-yaml'
import type { PlanV2, UiPrefs } from '@/lib/plan/schema'
import { parsePlanData } from '@/lib/plan/migrate'

export interface ImportedPlan {
  plan: PlanV2
  // Display preferences carried by v1 files (they used to live in the plan).
  uiPrefs: Partial<UiPrefs>
  migratedFrom: 1 | null
}

export function exportToYAML(plan: PlanV2): string {
  return yaml.dump(plan, { indent: 2, noRefs: true })
}

// Accepts any supported schema version; older files are migrated to v2.
export function importFromYAML(yamlString: string, now: Date = new Date()): ImportedPlan | null {
  try {
    const parsed = yaml.load(yamlString)
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    const result = parsePlanData(parsed, { now })
    if (!result.success) {
      console.error('Plan validation failed:', result.errors)
      return null
    }
    return { plan: result.plan, uiPrefs: result.uiPrefs, migratedFrom: result.migratedFrom }
  } catch (error) {
    console.error('Failed to parse YAML:', error)
    return null
  }
}

export function downloadYAML(content: string, filename: string = 'retirement-plan.yaml') {
  const blob = new Blob([content], { type: 'text/yaml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function uploadYAML(): Promise<ImportedPlan | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.yaml,.yml'

    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) {
        resolve(null)
        return
      }

      const reader = new FileReader()
      reader.onload = (event) => {
        const content = event.target?.result as string
        if (content) {
          resolve(importFromYAML(content))
        } else {
          resolve(null)
        }
      }
      reader.onerror = () => resolve(null)
      reader.readAsText(file)
    }

    input.click()
  })
}
