import { cn } from '@/lib/ui/cn'

export interface LegendItem {
  label: string
  color: string
  // 'line' for line series, 'dashed' for reference lines, 'dot' for areas/bars.
  shape?: 'dot' | 'line' | 'dashed'
}

// Legend in HTML (not inside the SVG) so it wraps on small screens and the
// text stays in text colours rather than the series colour.
export function ChartLegend({ items, className }: { items: LegendItem[]; className?: string }) {
  return (
    <ul className={cn('flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-fg-secondary', className)}>
      {items.map(item => (
        <li key={item.label} className="flex items-center gap-1.5">
          {item.shape === 'line' ? (
            <span className="h-0.5 w-4 rounded" style={{ background: item.color }} aria-hidden />
          ) : item.shape === 'dashed' ? (
            <span className="w-4 border-t-2 border-dashed" style={{ borderColor: item.color }} aria-hidden />
          ) : (
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} aria-hidden />
          )}
          {item.label}
        </li>
      ))}
    </ul>
  )
}
