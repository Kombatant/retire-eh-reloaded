import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import App from '@/App'

// Recharts and the dark-mode hook rely on browser APIs jsdom does not provide.
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
})

beforeEach(() => {
  localStorage.clear()
})

describe('App smoke test', () => {
  it('renders every tab without hitting an error boundary', async () => {
    render(<App />)
    const nav = screen.getByRole('navigation', { name: 'Tabs' })
    for (const label of ['Plan', 'Overview', 'Projections', 'Cash Flow', 'Risk', 'Compare', 'Tracking', 'Learn']) {
      fireEvent.click(within(nav).getByText(label))
      expect(await screen.findAllByText(/./)).not.toHaveLength(0)
      expect(screen.queryByText(/Something went wrong/i)).toBeNull()
    }
  })

  it('loads a plan saved by the v1 app', () => {
    localStorage.setItem('people', JSON.stringify([{
      id: '1', name: 'Legacy Larry', currentAge: 50, retirementAge: 62,
      annualIncome: 80000, annualPension: 0, accounts: [],
    }]))
    render(<App />)
    expect(screen.getByDisplayValue('Legacy Larry')).toBeInTheDocument()
  })
})
