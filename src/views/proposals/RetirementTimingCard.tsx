import { useState } from 'react'
import { CalendarClock, Check, Copy } from 'lucide-react'
import { useRetirementTiming } from '@/hooks/useRetirementTiming'
import { describeChange, TARGET_SUCCESS, type PlanScore, type Proposal } from '@/lib/insights/proposals'
import type { RetirementAgeOption, RetirementTiming } from '@/lib/insights/retirementTiming'
import { moneyCompact } from '@/lib/formatting'
import { cn } from '@/lib/ui/cn'
import { Card, CardHeader } from '@/components/ui/Card'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Callout } from '@/components/ui/Callout'
import { moneyDelta, pct, TARGET_PCT, TONE, type DeltaView } from './format'
import { TestingProgress } from './TestingProgress'

const ageLabel = (o: RetirementAgeOption) => (
  o.ages.length === 1 ? String(o.ages[0].age) : o.ages.map(a => `${a.name} ${a.age}`).join(' · ')
)
const yearsWord = (n: number) => `${Math.abs(n)} year${Math.abs(n) === 1 ? '' : 's'}`

function versusPlan(shift: number) {
  if (shift === 0) return 'That is the age already in your plan.'
  return `That is ${yearsWord(shift)} ${shift < 0 ? 'earlier' : 'later'} than your plan.`
}

function verdict(o: RetirementAgeOption): { tone: BadgeTone; text: string } {
  if (o.safe) return { tone: 'success', text: `Reaches ${TARGET_PCT}% and your goal` }
  if (o.score.successRate !== null && o.score.successRate < TARGET_SUCCESS) return { tone: 'warning', text: `Below ${TARGET_PCT}% chance of success` }
  if (!o.score.onTrack) return { tone: 'warning', text: 'Short of your goal' }
  return { tone: 'warning', text: 'Runs short in some years' }
}

function pointsDelta(label: string, change: number): DeltaView {
  const points = Math.round(change)
  if (points === 0) return { label, text: 'No change', tone: 'none' }
  return { label, text: `${Math.abs(points)} pts ${points > 0 ? 'higher' : 'lower'}`, tone: points > 0 ? 'good' : 'bad' }
}

function impactRows(base: PlanScore, s: PlanScore): { value: string; delta: DeltaView }[] {
  const rows = [
    { value: `${Math.round(s.goalProgressPct)}%`, delta: pointsDelta('Goal progress', Math.round(s.goalProgressPct) - Math.round(base.goalProgressPct)) },
    { value: moneyCompact(s.averageIncome), delta: moneyDelta('Yearly income after tax', s.averageIncome - base.averageIncome, true) },
    { value: moneyCompact(s.afterTaxEstate), delta: moneyDelta('Estate after tax', s.afterTaxEstate - base.afterTaxEstate, true) },
    { value: moneyCompact(s.lifetimeTax), delta: moneyDelta('Lifetime tax', s.lifetimeTax - base.lifetimeTax, false) },
  ]
  if (s.successRate === null || base.successRate === null) return rows
  return [
    { value: pct(s.successRate), delta: pointsDelta('Chance of success', Math.round(s.successRate * 100) - Math.round(base.successRate * 100)) },
    ...rows,
  ]
}

function Headline({ timing }: { timing: RetirementTiming }) {
  const { options, safestIndex, bestIndex } = timing
  if (safestIndex === null) {
    const best = options[bestIndex]
    return (
      <div>
        <p className="text-lg font-semibold text-fg">No age tested is safe yet</p>
        <p className="mt-0.5 text-sm text-fg-muted">
          The best result is at {ageLabel(best)}, with {best.score.successRate !== null && `a ${pct(best.score.successRate)} chance of success and `}{Math.round(best.score.goalProgressPct)}% of your goal.
          Changing when you retire isn’t enough on its own, so look at spending and saving as well.
        </p>
      </div>
    )
  }
  const safest = options[safestIndex]
  return (
    <div>
      <p className="text-lg font-semibold text-fg">Earliest safe age: {ageLabel(safest)}</p>
      <p className="mt-0.5 text-sm text-fg-muted">
        {versusPlan(safest.shift)} {safest.score.successRate !== null && `Retiring then gives a ${pct(safest.score.successRate)} chance of success. `}Later ages stay safe too.
      </p>
    </div>
  )
}

function TimingExplorer({ timing, onApply, onCopy }: {
  timing: RetirementTiming
  onApply: (p: Proposal) => void
  onCopy: (p: Proposal) => void
}) {
  const { options, currentIndex, safestIndex, bestIndex, runs } = timing
  const [picked, setPicked] = useState<number | null>(null)
  const index = picked ?? safestIndex ?? bestIndex
  const option = options[index]
  const status = verdict(option)
  const isCurrent = index === currentIndex
  const base = options[currentIndex].score

  const change = { kind: 'retirementShift', years: option.shift } as const
  const proposal: Proposal = { id: `age-${option.shift}`, group: 'tradeoff', ...describeChange(change), changes: [change], score: option.score }

  return (
    <div className="space-y-5">
      <Headline timing={timing} />

      {options.length > 1 && (
        <div>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-fg">Retire at {ageLabel(option)}</span>
            <Badge tone={status.tone}>{status.text}</Badge>
          </div>
          <input
            type="range"
            min={0}
            max={options.length - 1}
            value={index}
            onChange={e => setPicked(Number(e.target.value))}
            className="h-5 w-full"
            aria-label="Retirement age to try"
            aria-valuetext={`Retire at ${ageLabel(option)}. ${status.text}.`}
          />
          <div className="mt-1 flex justify-between gap-2 text-xs text-fg-muted">
            <span>{ageLabel(options[0])}</span>
            <span className="flex gap-3">
              <button type="button" className="hover:text-fg" onClick={() => setPicked(currentIndex)}>Your plan: {ageLabel(options[currentIndex])}</button>
              {safestIndex !== null && safestIndex !== currentIndex && (
                <button type="button" className="hover:text-fg" onClick={() => setPicked(safestIndex)}>Safest: {ageLabel(options[safestIndex])}</button>
              )}
            </span>
            <span>{ageLabel(options[options.length - 1])}</span>
          </div>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-5">
        {impactRows(base, option.score).map(({ value, delta }) => (
          <div key={delta.label} className="min-w-0">
            <dt className="text-xs text-fg-muted">{delta.label}</dt>
            <dd className="text-lg font-semibold text-fg">{value}</dd>
            <dd className={cn('text-xs font-medium', TONE[isCurrent ? 'none' : delta.tone])}>{isCurrent ? 'Your plan' : delta.text}</dd>
          </div>
        ))}
      </dl>

      {!isCurrent && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={Copy} onClick={() => onCopy(proposal)}>Try as a new plan</Button>
          <Button size="sm" variant="ghost" icon={Check} onClick={() => onApply(proposal)}>Apply to this plan</Button>
        </div>
      )}

      <p className="text-xs text-fg-muted">
        Ages {ageLabel(options[0])} to {ageLabel(options[options.length - 1])} tested on {runs.toLocaleString('en-CA')} simulated markets each. Pay and contributions that end at retirement move with the age you pick.
      </p>
    </div>
  )
}

export function RetirementTimingCard({ onApply, onCopy }: {
  onApply: (p: Proposal) => void
  onCopy: (p: Proposal) => void
}) {
  const { timing, done, progress = 0, error } = useRetirementTiming()
  // Nobody left to retire, so there is no age to choose.
  if (done && !timing) return null

  return (
    <Card padding="lg">
      <CardHeader
        title="When it’s safest to retire"
        description={`The earliest age with at least a ${TARGET_PCT}% chance of success that also reaches your goal. It can be before or after the age in your plan.`}
        icon={CalendarClock}
      />
      {error
        ? <Callout tone="danger" title="Something went wrong">{error}</Callout>
        : timing
          // Ages are the identity: a new range must not inherit the old slider position.
          ? <TimingExplorer key={JSON.stringify(timing.options.map(o => o.ages))} timing={timing} onApply={onApply} onCopy={onCopy} />
          : <TestingProgress label="Testing retirement ages…" progress={progress} />}
    </Card>
  )
}
