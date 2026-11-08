import { moneyCompact } from '@/lib/formatting'
import { TARGET_SUCCESS } from '@/lib/insights/proposals'

export const TARGET_PCT = Math.round(TARGET_SUCCESS * 100)
export const pct = (rate: number | null) => (rate === null ? 'n/a' : `${Math.round(rate * 100)}%`)

export interface DeltaView {
  label: string
  text: string
  tone: 'good' | 'bad' | 'none'
}

// Direction is always in the words; the colour only adds to it.
export function moneyDelta(label: string, change: number, moreIsGood: boolean): DeltaView {
  if (Math.abs(change) < 500) return { label, text: 'No change', tone: 'none' }
  const more = change > 0
  return { label, text: `${moneyCompact(Math.abs(change))} ${more ? 'more' : 'less'}`, tone: more === moreIsGood ? 'good' : 'bad' }
}

export const TONE: Record<DeltaView['tone'], string> = { good: 'text-success', bad: 'text-danger', none: 'text-fg-secondary' }
