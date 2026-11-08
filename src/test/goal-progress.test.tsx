import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { GoalProgress } from '@/components/GoalProgress'
import type { RetirementOutlook } from '@/lib/insights/outlook'

const outlook = (overrides: Partial<RetirementOutlook> = {}): RetirementOutlook => ({
  onTrack: true, progressPct: 120, progressBasis: 'preTax', preTaxIncome: 64_000, afterTaxIncome: 55_000,
  estimatedTax: 9_000, extraSavingsNeeded: 0, annualRoom: 4_000, noSavingsNeeded: false, metOnPaperOnly: false, propertySaleValue: 0,
  ...overrides,
})

describe('GoalProgress', () => {
  it('says when progress relies on selling property later', () => {
    const { rerender } = render(<GoalProgress outlook={outlook()} barClassName="h-2" />)
    expect(screen.queryByText(/planned property sale/)).toBeNull()
    rerender(<GoalProgress outlook={outlook({ propertySaleValue: 250_000 })} barClassName="h-2" />)
    expect(screen.getByText(/planned property sale/).textContent).toContain('$250,000')
  })

  it('shows the percentage past 100 with a full bar and the room in dollars', () => {
    render(<GoalProgress outlook={outlook()} barClassName="h-2" />)
    expect(screen.getByText('120%')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '120%')
    expect(screen.getByText('$4,000')).toBeInTheDocument()
  })

  it('offers Proposals only where asked to', () => {
    const onTestRoom = vi.fn()
    const { rerender } = render(<GoalProgress outlook={outlook()} barClassName="h-2" />)
    expect(screen.queryByRole('button', { name: /proposals/i })).toBeNull()
    rerender(<GoalProgress outlook={outlook()} barClassName="h-2" onTestRoom={onTestRoom} />)
    fireEvent.click(screen.getByRole('button', { name: /proposals/i }))
    expect(onTestRoom).toHaveBeenCalledOnce()
  })

  it('says the goal is met when guaranteed income covers it', () => {
    render(<GoalProgress outlook={outlook({ progressPct: 100, noSavingsNeeded: true, annualRoom: 14_000 })} barClassName="h-2" />)
    expect(screen.getByText('Met')).toBeInTheDocument()
    expect(screen.queryByText('100%')).toBeNull()
    expect(screen.getByText(/Guaranteed income covers your goal/)).toBeInTheDocument()
    expect(screen.getByText('$14,000')).toBeInTheDocument()
  })

  it('explains a goal met on paper that the simulation can not fund', () => {
    render(<GoalProgress outlook={outlook({ onTrack: false, annualRoom: null, metOnPaperOnly: true })} barClassName="h-2" />)
    expect(screen.getByText(/runs short/)).toBeInTheDocument()
    expect(screen.queryByText(/of room/)).toBeNull()
  })

  it('adds no note when short of the goal', () => {
    render(<GoalProgress outlook={outlook({ onTrack: false, progressPct: 80, annualRoom: null })} barClassName="h-2" />)
    expect(screen.queryByText(/of room|runs short/)).toBeNull()
  })
})
