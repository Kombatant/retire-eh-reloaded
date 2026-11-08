import type { MoneyMode } from '@/components/ui/Badge'

// The badge mode for a view that follows the "Today's $ / Future $" toggle.
export function moneyMode(showRealValues: boolean): MoneyMode {
  return showRealValues ? 'real' : 'nominal'
}
