import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import App from '@/App'
import { buildShareUrl } from '@/lib/share-link'
import { createDefaultPlan } from '@/lib/plan/defaults'
import { newIncome } from '@/lib/plan/edits'
import { accountSchema } from '@/lib/plan/schema'
import { AgeBucketTooltip } from '@/views/risk/FailureCards'

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

const PAGES = ['Plan', 'Dashboard', 'Projections', 'Cash flow', 'Taxes', 'Risk', 'Proposals', 'Compare', 'Tracking', 'Learn']
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

  it('shows tested proposals and applies one with undo', async () => {
    window.history.replaceState(null, '', '/#/proposals')
    render(<App />)
    await screen.findByText(/changes tested/, {}, { timeout: 20_000 })
    expect(screen.queryByText(/Something went wrong/i)).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: 'Apply to this plan' })[0])
    expect(await screen.findByText(/^Applied:/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.queryByText(/^Applied:/)).toBeNull()
  }, 30_000)

  it('tries other retirement ages on the Proposals slider', async () => {
    window.history.replaceState(null, '', '/#/proposals')
    render(<App />)
    const slider = await screen.findByRole('slider', { name: 'Retirement age to try' }, { timeout: 20_000 })
    expect(screen.getByText('When it’s safest to retire')).toBeInTheDocument()
    const next = Number((slider as HTMLInputElement).value) === 0 ? 1 : 0
    fireEvent.change(slider, { target: { value: String(next) } })
    expect((slider as HTMLInputElement).value).toBe(String(next))
    expect(screen.queryByText(/Something went wrong/i)).toBeNull()
  }, 30_000)

  it('explains how a failing plan fails and what would fix it', async () => {
    const base = createDefaultPlan(new Date())
    const plan = {
      ...base,
      expenses: { ...base.expenses, mode: 'detailed' as const, items: [{ id: 'budget', label: 'Budget', category: 'general', amount: 250_000, frequency: 'annual' as const, essential: true, indexed: true, realGrowthPct: 0 }] },
      drawdown: { ...base.drawdown, strategy: { kind: 'expenses' as const } },
    }
    window.history.replaceState(null, '', '/#/risk/monte-carlo')
    localStorage.setItem('retireEh.v2', JSON.stringify({ schemaVersion: 2, activePlanId: plan.id, plans: [plan] }))
    render(<App />)
    expect(await screen.findByText('How your plan fails', {}, { timeout: 20_000 })).toBeInTheDocument()
    expect(screen.getByText('First falls short')).toBeInTheDocument()
    expect(await screen.findByText('What needs to happen', {}, { timeout: 20_000 })).toBeInTheDocument()
    expect(screen.queryByText(/Something went wrong/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'See all proposals' }))
    expect(window.location.hash).toBe('#/proposals')
  }, 40_000)

  it('shows what the failing runs at an age had in common', () => {
    const detail = { shortYears: 12, annualShortfall: 40_000, totalShortfall: 480_000, fundedShare: 0.6, earlyRealReturn: 0.012, savingsAtRetirement: 900_000, moneyLeft: 3 }
    const { rerender } = render(<AgeBucketTooltip active unit="runs" failed={80} payload={[{ payload: { label: '70–74', runs: 10, detail } }]} />)
    expect(screen.getByText('First short at age 70–74')).toBeInTheDocument()
    expect(screen.getByText('10 failing runs · 13% of all failures')).toBeInTheDocument()
    expect(screen.getByText('12 years')).toBeInTheDocument()
    expect(screen.getByText('60%')).toBeInTheDocument()
    expect(screen.getByText('7 of 10')).toBeInTheDocument()
    expect(screen.getByText('1.2% after inflation')).toBeInTheDocument()
    rerender(<AgeBucketTooltip active unit="start years" failed={80} payload={[{ payload: { label: '75–79', runs: 0, detail: null } }]} />)
    expect(screen.getByText('No failing start years first fell short at these ages.')).toBeInTheDocument()
    rerender(<AgeBucketTooltip unit="runs" failed={80} />)
    expect(screen.queryByText(/First short/)).toBeNull()
  })

  it('opens the page named in the URL hash', () => {
    window.history.replaceState(null, '', '/#/learn')
    render(<App />)
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByText('Learn').closest('a')).toHaveAttribute('aria-current', 'page')
  })

  it('shows where retirement money comes from, as a chart and a table', () => {
    window.history.replaceState(null, '', '/#/projections/drawdown')
    render(<App />)
    expect(screen.getByText('Where your money comes from')).toBeInTheDocument()
    expect(screen.getByText('Savings by account through retirement')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Table' }))
    expect(screen.getByRole('columnheader', { name: 'Left to spend after tax' })).toBeInTheDocument()
    expect(screen.queryByText(/Something went wrong/i)).toBeNull()
  })

  it('compares retirement spending in dollars or as a share of savings', () => {
    window.history.replaceState(null, '', '/#/projections/drawdown')
    render(<App />)
    expect(screen.getByText('Withdrawal rates')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Dollars a year' }))
    expect(screen.getByText('Spending more or less')).toBeInTheDocument()
    expect(screen.getByText(/a year \(your plan/)).toBeInTheDocument()
    expect(screen.queryByText(/Something went wrong/i)).toBeNull()
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

  it('sets how the account created for reinvested money is invested', () => {
    window.history.replaceState(null, '', '/#/plan/withdrawals')
    render(<App />)
    fireEvent.click(screen.getByRole('switch', { name: 'Advanced mode' }))
    const mix = screen.getByLabelText(/Investment mix of the new non-registered account/)
    fireEvent.change(mix, { target: { value: 'balanced' } })
    expect(mix).toHaveValue('balanced')
    expect(screen.getByText('5.1% a year')).toBeInTheDocument()
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

  it('adds an RSU bonus and asks for a stock when there is none', () => {
    window.history.replaceState(null, '', '/#/plan/income')
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Add income/ }))
    fireEvent.click(screen.getByText('Yearly RSU bonus'))
    expect(screen.getByText('Typical value per year')).toBeInTheDocument()
    expect(screen.getByText('No stock to follow yet')).toBeInTheDocument()
    expect(screen.queryByText(/Something went wrong/i)).toBeNull()
  })

  it('shows the shares an RSU bonus buys at the projected price', () => {
    const shared = createDefaultPlan(new Date(2026, 0, 1), 'Stock plan')
    const owner = shared.people[0].id
    shared.accounts.push(accountSchema.parse({
      id: 'stock', ownerId: owner, type: 'STOCK', balance: 0, label: 'Work shares',
      holdings: [{ id: 'h', symbol: 'ACME', shares: 10, priceUsd: 100 }],
    }))
    shared.incomes.push(newIncome('rsuBonus', owner, 'rsu-income'))
    window.history.replaceState(null, '', new URL(buildShareUrl(shared, 'http://localhost/')).hash || '/')
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Load shared plan' }))
    const nav = screen.getByRole('navigation', { name: 'Main' })
    fireEvent.click(within(nav).getByText('Plan'))
    fireEvent.click(within(nav).getByText('Income'))
    fireEvent.click(screen.getByRole('button', { name: 'Edit RSU bonus' }))
    expect(screen.getByRole('option', { name: 'ACME (Work shares)' })).toBeInTheDocument()
    expect(screen.getByText(/shares, about [\d,\s]+ after tax/)).toBeInTheDocument()
    expect(screen.queryByText(/Something went wrong/i)).toBeNull()
  })
})
