import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import App from '@/App'
import { buildShareUrl } from '@/lib/share-link'
import { createDefaultPlan } from '@/lib/plan/defaults'

// Recharts and the theme provider rely on browser APIs jsdom does not provide.
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
  // Routes live in the URL hash, which would otherwise leak between tests.
  window.history.replaceState(null, '', '/')
  document.documentElement.classList.remove('dark')
})

const PAGES = ['Plan', 'Dashboard', 'Projections', 'Cash flow', 'Taxes', 'Risk', 'Compare', 'Tracking', 'Learn']
const PLAN_SECTIONS = ['Household', 'Savings', 'Income', 'Spending', 'Home & debts', 'Withdrawals', 'Assumptions']

describe('App smoke test', () => {
  it('renders every page without hitting an error boundary', async () => {
    render(<App />)
    const nav = screen.getByRole('navigation', { name: 'Main' })
    for (const label of PAGES) {
      fireEvent.click(within(nav).getByText(label))
      expect(within(nav).getByText(label).closest('a')).toHaveAttribute('aria-current', 'page')
      expect(await screen.findAllByText(/./)).not.toHaveLength(0)
      expect(screen.queryByText(/Something went wrong/i)).toBeNull()
    }
  })

  it('renders every plan section', async () => {
    render(<App />)
    const nav = screen.getByRole('navigation', { name: 'Main' })
    for (const label of PLAN_SECTIONS) {
      fireEvent.click(within(nav).getByText(label))
      expect(window.location.hash).toMatch(/^#\/plan\//)
      expect(screen.queryByText(/Something went wrong/i)).toBeNull()
    }
  })

  it('opens the page named in the URL hash', () => {
    window.history.replaceState(null, '', '/#/learn')
    render(<App />)
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByText('Learn').closest('a')).toHaveAttribute('aria-current', 'page')
  })

  it('loads a plan saved by the v1 app', () => {
    localStorage.setItem('people', JSON.stringify([{
      id: '1', name: 'Legacy Larry', currentAge: 50, retirementAge: 62,
      annualIncome: 80000, annualPension: 0, accounts: [],
    }]))
    render(<App />)
    expect(screen.getByDisplayValue('Legacy Larry')).toBeInTheDocument()
  })

  it('hides advanced inputs until Advanced mode is on', () => {
    render(<App />)
    expect(screen.queryByText('Contribution room')).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'Advanced mode' }))
    expect(screen.getByText('Contribution room')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch', { name: 'Advanced mode' }))
    expect(screen.queryByText('Contribution room')).toBeNull()
  })

  it('says when hidden advanced settings still apply', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('switch', { name: 'Advanced mode' }))
    fireEvent.click(screen.getByLabelText('Track RRSP and TFSA contribution room'))
    fireEvent.click(screen.getByRole('switch', { name: 'Advanced mode' }))
    expect(screen.getByText('1 advanced setting is active')).toBeInTheDocument()
  })

  it('switches the theme for the whole app', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(document.documentElement).toHaveClass('dark')
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }))
    expect(document.documentElement).not.toHaveClass('dark')
  })

  it('loads a shared plan and lands on the dashboard', () => {
    const shared = createDefaultPlan(new Date(2026, 0, 1), 'Shared plan')
    shared.people[0].name = 'Sharon Shared'
    window.history.replaceState(null, '', new URL(buildShareUrl(shared, 'http://localhost/')).hash || '/')
    render(<App />)
    expect(screen.getByText(/You've opened a shared retirement plan/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load shared plan' }))
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByText('Dashboard').closest('a')).toHaveAttribute('aria-current', 'page')
    expect(window.location.hash).toBe('#/dashboard')
  })
})
