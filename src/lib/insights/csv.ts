export type CsvValue = string | number | null | undefined

function cell(value: CsvValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : ''
  // A spreadsheet runs a cell that starts like a formula. Text only: numbers
  // above are real numbers, negatives included.
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

// RFC 4180 CSV with a header row.
export function toCsv(headers: string[], rows: CsvValue[][]): string {
  return [headers, ...rows].map(r => r.map(cell).join(',')).join('\r\n')
}

export function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
