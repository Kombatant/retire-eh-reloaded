export function formatMoney(value: number): string {
  return value.toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export function formatCompactMoney(value: number): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(0)}k`
  }
  return `${value.toFixed(0)}`
}

// "$1,234" / "−$1,234". Use for display; formatMoney stays digits-only.
export function money(value: number): string {
  const sign = value < 0 ? '−' : ''
  return `${sign}$${formatMoney(Math.abs(value))}`
}

// "$1.2M" / "$350k" / "$900", for tight spaces such as KPI tiles and axes.
export function moneyCompact(value: number): string {
  const sign = value < 0 ? '−' : ''
  return `${sign}$${formatCompactMoney(Math.abs(value))}`
}

export function formatCurrency(value: number | string): string {
  const num = typeof value === 'string' ? parseFloat(value.replace(/,/g, '')) || 0 : value
  return num.toLocaleString('en-CA')
}
