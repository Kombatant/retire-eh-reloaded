import type { RetirementOutlook } from '@/lib/insights/outlook'
import { money } from '@/lib/formatting'
import { cn } from '@/lib/ui/cn'

// Goal progress and what it means past 100%, shared by the Dashboard and the
// Plan live rail so both explain the margin the same way.
export function GoalProgress({ outlook, barClassName, onTestRoom }: {
  outlook: RetirementOutlook
  barClassName: string
  onTestRoom?: () => void
}) {
  const barWidth = Math.max(0, Math.min(100, outlook.progressPct))
  const value = outlook.noSavingsNeeded ? 'Met' : `${Math.round(outlook.progressPct)}%`
  const room = outlook.annualRoom !== null && outlook.annualRoom > 0 ? outlook.annualRoom : null

  return (
    <div>
      <div className="flex justify-between text-xs text-fg-muted">
        <span>Goal progress{outlook.progressBasis === 'afterTax' ? ', after tax' : ''}</span>
        <span className="font-medium text-fg">{value}</span>
      </div>
      <div
        className={cn('mt-1.5 overflow-hidden rounded-full bg-surface-muted', barClassName)}
        role="progressbar"
        aria-label="Goal progress"
        aria-valuenow={Math.round(barWidth)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={value}
      >
        <div
          className={cn('h-full rounded-full', outlook.onTrack ? 'bg-success' : 'bg-warning')}
          style={{ width: `${barWidth}%` }}
        />
      </div>
      {outlook.propertySaleValue > 0 && (
        <p className="mt-2 text-xs text-fg-secondary">
          Counts about <span className="font-medium text-fg">{money(outlook.propertySaleValue)}</span> from a planned property sale, valued at retirement.
        </p>
      )}
      {outlook.metOnPaperOnly ? (
        <p className="mt-2 text-xs text-fg-secondary">
          Your savings reach the goal on paper, but the year-by-year simulation runs short, so there's no room to add spending.
        </p>
      ) : (outlook.onTrack && (outlook.noSavingsNeeded || room !== null)) && (
        <p className="mt-2 text-xs text-fg-secondary">
          {outlook.noSavingsNeeded && 'Guaranteed income covers your goal without savings. '}
          {room !== null && (
            <>
              About <span className="font-medium text-fg">{money(room)}</span> a year of room above your goal.
              {onTestRoom && (
                <>
                  {' '}
                  <button type="button" onClick={onTestRoom} className="font-medium text-accent hover:text-accent-hover">
                    Test it in Proposals
                  </button>
                </>
              )}
            </>
          )}
        </p>
      )}
    </div>
  )
}
