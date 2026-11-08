import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import App from '@/App'
import { createDefaultPlan } from '@/lib/plan/defaults'
import { isPlanNameTaken, suggestPlanName } from '@/lib/plan/names'
import type { PlanV2 } from '@/lib/plan/schema'
import { STORE_KEY } from '@/lib/plan/storage'
import { uploadYAML } from '@/lib/yaml-utils'

vi.mock('@/lib/yaml-utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/yaml-utils')>()),
  uploadYAML: vi.fn(),
}))

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  window.matchMedia ??= vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
})

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

const planNamed = (name: string): PlanV2 => createDefaultPlan(new Date(2026, 0, 1), name)

function stored(): { plans: PlanV2[]; activePlanId: string } {
  return JSON.parse(localStorage.getItem(STORE_KEY)!)
}

async function openImport(plan: PlanV2) {
  vi.mocked(uploadYAML).mockResolvedValueOnce({ plan, uiPrefs: {}, migratedFrom: null })
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: /Import plan/ }))
  await screen.findByRole('radiogroup', { name: 'How to import' })
}

const nameField = () => screen.queryByLabelText('Plan name') as HTMLInputElement | null

describe('importing a plan from a file', () => {
  it('asks first and changes nothing until confirmed', async () => {
    render(<App />)
    const before = stored()
    await openImport(planNamed('From file'))
    expect(stored()).toEqual(before)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('radiogroup', { name: 'How to import' })).toBeNull())
    expect(stored()).toEqual(before)
  })

  it('adds a new plan by default and keeps the open one', async () => {
    render(<App />)
    const original = stored().plans[0]
    await openImport(planNamed('From file'))
    expect(nameField()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add plan' }))
    await waitFor(() => expect(stored().plans).toHaveLength(2))
    const { plans, activePlanId } = stored()
    expect(plans[0]).toEqual(original)
    expect(plans[1].name).toBe('From file')
    expect(activePlanId).toBe(plans[1].id)
  })

  it('gives a new plan its own id when the file came from a plan still in the list', async () => {
    render(<App />)
    const original = stored().plans[0]
    await openImport({ ...original, name: 'Exported earlier' })
    fireEvent.click(screen.getByRole('button', { name: 'Add plan' }))
    await waitFor(() => expect(stored().plans).toHaveLength(2))
    expect(stored().plans[1].id).not.toBe(original.id)
  })

  it('asks for a name only when a new plan would clash', async () => {
    render(<App />)
    await openImport(planNamed('my plan'))
    expect(nameField()?.value).toBe('my plan (2)')

    fireEvent.change(nameField()!, { target: { value: 'MY PLAN' } })
    expect(screen.getByRole('button', { name: 'Add plan' })).toBeDisabled()
    fireEvent.change(nameField()!, { target: { value: '  ' } })
    expect(screen.getByRole('button', { name: 'Add plan' })).toBeDisabled()

    fireEvent.change(nameField()!, { target: { value: '  Second opinion ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add plan' }))
    await waitFor(() => expect(stored().plans).toHaveLength(2))
    expect(stored().plans[1].name).toBe('Second opinion')
  })

  it('overwrites the open plan when asked, without a name prompt for its own name', async () => {
    render(<App />)
    const original = stored().plans[0]
    await openImport({ ...planNamed('My plan'), people: [{ ...planNamed('x').people[0], name: 'Imported person' }] })
    fireEvent.click(screen.getByRole('radio', { name: 'Replace open plan' }))
    expect(nameField()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Replace plan' }))
    await waitFor(() => expect(stored().plans[0].people[0].name).toBe('Imported person'))
    expect(stored().plans).toHaveLength(1)
    expect(stored().plans[0].id).toBe(original.id)
  })

  it('asks for a name when a replacement would clash with another plan', async () => {
    render(<App />)
    await openImport(planNamed('Second'))
    fireEvent.click(screen.getByRole('button', { name: 'Add plan' }))
    await waitFor(() => expect(stored().plans).toHaveLength(2))

    // "Second" is open, so importing "My plan" over it clashes with the first.
    await openImport(planNamed('My plan'))
    fireEvent.click(screen.getByRole('radio', { name: 'Replace open plan' }))
    expect(nameField()?.value).toBe('My plan (2)')
    fireEvent.click(screen.getByRole('button', { name: 'Replace plan' }))
    await waitFor(() => expect(stored().plans[1].name).toBe('My plan (2)'))
    expect(stored().plans).toHaveLength(2)
  })
})

describe('plan names', () => {
  it('ignores case and stray spaces when comparing', () => {
    expect(isPlanNameTaken(' MY plan ', [{ name: 'My plan' }])).toBe(true)
    expect(isPlanNameTaken('Other', [{ name: 'My plan' }])).toBe(false)
  })

  it('suggests the first free number', () => {
    expect(suggestPlanName('A', [{ name: 'A' }])).toBe('A (2)')
    expect(suggestPlanName('A', [{ name: 'A' }, { name: 'a (2)' }, { name: 'A (3)' }])).toBe('A (4)')
  })
})
