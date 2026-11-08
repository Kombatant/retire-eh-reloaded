import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { Sheet } from '@/components/ui/Sheet'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { SubTabs } from '@/components/ui/SubTabs'
import { NumberInput } from '@/components/ui/NumberInput'
import { Field } from '@/components/ui/Field'
import { TextInput } from '@/components/ui/inputs'

describe('Sheet', () => {
  it('shows its content only while open and closes on Escape', () => {
    const onClose = vi.fn()
    const { rerender } = render(<Sheet open={false} onClose={onClose} title="Edit account">Body</Sheet>)
    expect(screen.queryByText('Body')).toBeNull()

    rerender(<Sheet open onClose={onClose} title="Edit account">Body</Sheet>)
    expect(screen.getByText('Body')).toBeInTheDocument()
    const dialog = screen.getByText('Body').closest('dialog')!
    expect(dialog).toHaveAttribute('open')

    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes from the close button', () => {
    const onClose = vi.fn()
    render(<Sheet open onClose={onClose} title="Edit">Body</Sheet>)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('SegmentedControl', () => {
  function Harness() {
    const [value, setValue] = useState<'a' | 'b' | 'c'>('a')
    return (
      <SegmentedControl
        ariaLabel="Pick"
        value={value}
        onChange={setValue}
        options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }]}
      />
    )
  }

  it('is a radio group with one tab stop and arrow-key selection', () => {
    render(<Harness />)
    const radios = screen.getAllByRole('radio')
    expect(radios.map(r => r.getAttribute('tabindex'))).toEqual(['0', '-1', '-1'])
    expect(radios[0]).toHaveAttribute('aria-checked', 'true')

    fireEvent.keyDown(radios[0], { key: 'ArrowLeft' })
    expect(screen.getByRole('radio', { name: 'C' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('radio', { name: 'B' }))
    expect(screen.getByRole('radio', { name: 'B' })).toHaveAttribute('aria-checked', 'true')
  })
})

describe('SubTabs', () => {
  function Harness() {
    const [value, setValue] = useState<'one' | 'two'>('one')
    return (
      <SubTabs ariaLabel="Views" value={value} onChange={setValue} tabs={[{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }]}>
        <p>Panel {value}</p>
      </SubTabs>
    )
  }

  it('follows the tabs pattern and switches panels', () => {
    render(<Harness />)
    expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel one')

    fireEvent.keyDown(screen.getByRole('tab', { name: 'One' }), { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel two')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', screen.getByRole('tab', { name: 'Two' }).id)
  })
})

describe('NumberInput', () => {
  it('formats at rest, edits raw while focused, and ignores separators', () => {
    const onChange = vi.fn()
    render(<NumberInput value={125000} onChange={onChange} ariaLabel="Balance" />)
    const input = screen.getByRole('textbox', { name: 'Balance' }) as HTMLInputElement
    expect(input.value).toBe('125,000')

    act(() => input.focus())
    expect(input.value).toBe('125000')
    fireEvent.change(input, { target: { value: '$1,500' } })
    expect(onChange).toHaveBeenLastCalledWith(1500)
  })

  it('accepts decimals, keeping a trailing point while typing', () => {
    const onChange = vi.fn()
    const { rerender } = render(<NumberInput value={1850} onChange={onChange} ariaLabel="Payment" />)
    const input = screen.getByRole('textbox', { name: 'Payment' }) as HTMLInputElement
    act(() => input.focus())
    fireEvent.change(input, { target: { value: '1850.' } })
    rerender(<NumberInput value={1850} onChange={onChange} ariaLabel="Payment" />)
    expect(input.value).toBe('1850.')
    fireEvent.change(input, { target: { value: '1850.75' } })
    expect(onChange).toHaveBeenLastCalledWith(1850.75)
    // More digits than allowed are ignored.
    fireEvent.change(input, { target: { value: '1850.755' } })
    expect(onChange).toHaveBeenLastCalledWith(1850.75)
    rerender(<NumberInput value={1850.75} onChange={onChange} ariaLabel="Payment" />)
    act(() => input.blur())
    expect(input.value).toBe('1,850.75')
  })
})

describe('Field', () => {
  it('labels the control inside it', () => {
    render(<Field label="Plan name"><TextInput defaultValue="Main" /></Field>)
    expect(screen.getByLabelText('Plan name')).toHaveValue('Main')
  })
})
