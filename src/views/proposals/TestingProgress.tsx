export function TestingProgress({ label, detail, progress }: { label: string; detail?: string; progress: number }) {
  return (
    <div role="status" className="max-w-xl">
      <div className="flex justify-between text-xs text-fg-muted">
        <span>{label}</span>
        {detail && <span>{detail}</span>}
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
    </div>
  )
}
