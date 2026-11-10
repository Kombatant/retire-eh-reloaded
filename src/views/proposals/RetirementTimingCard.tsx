import { useState, type ReactNode } from 'react'
import { CalendarClock, Check, Copy, RotateCcw } from 'lucide-react'
import { useRetirementTiming } from '@/hooks/useRetirementTiming'
import { useSpendingAtAge } from '@/hooks/useSpendingAtAge'
import { describeChange, TARGET_SUCCESS, type PlanScore, type Proposal } from '@/lib/insights/proposals'
import {
  SPENDING_STEPS_PCT, timingChanges, type RetirementAgeOption, type RetirementTiming, type SpendingAtAge,
} from '@/lib/insights/retirementTiming'
import { money, moneyCompact } from '@/lib/formatting'
import { cn } from '@/lib/ui/cn'
import { Card, CardHeader } from '@/components/ui/Card'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Callout } from '@/components/ui/Callout'
import { moneyDelta, pct, TARGET_PCT, TONE, type DeltaView } from './format'
import { TestingProgress } from './TestingProgress'

const PLAN_SPENDING_INDEX = SPENDING_STEPS_PCT.indexOf(0)

const ageLabel = (o: RetirementAgeOption) => (
  o.ages.length === 1 ? String(o.ages[0].age) : o.ages.map(a => `${a.name} ${a.age}`).join(' · ')
)
const yearsWord = (n: number) => `${Math.abs(n)} year${Math.abs(n) === 1 ? '' : 's'}`

function versusPlan(shift: number) {
  if (shift === 0) return 'That is the age already in your plan.'
  return `That is ${yearsWord(shift)} ${shift < 0 ? 'earlier' : 'later'} than your plan.`
}

const shiftWords = (shift: number) => (shift === 0 ? 'Your plan' : `${yearsWord(shift)} ${shift < 0 ? 'earlier' : 'later'} than your plan`)
const pctWords = (p: number) => (p === 0 ? 'Your plan' : `${Math.abs(p)}% ${p < 0 ? 'less' : 'more'} than your plan`)
// Rounded so the slider doesn't suggest more precision than a percentage step has.
const spendingAt = (base: number, p: number) => Math.round((base * (1 + p / 100)) / 100) * 100

function verdict(o: { safe: boolean; score: PlanScore }): { tone: BadgeTone; text: string } {
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
        <p className="text-lg font-semibold text-fg">No age tested is safe at your current spending</p>
        <p className="mt-0.5 text-sm text-fg-muted">
          The best result is at {ageLabel(best)}, with {best.score.successRate !== null && `a ${pct(best.score.successRate)} chance of success and `}{Math.round(best.score.goalProgressPct)}% of your goal.
          Lower your spending below to see what would make it safe.
        </p>
      </div>
    )
  }
  const safest = options[safestIndex]
  return (
    <div>
      <p className="text-lg font-semibold text-fg">Earliest safe age: {ageLabel(safest)}</p>
      <p className="mt-0.5 text-sm text-fg-muted">
        {versusPlan(safest.shift)} {safest.score.successRate !== null && `Retiring then gives a ${pct(safest.score.successRate)} chance of success. `}Every later age tested stays safe too.
      </p>
    </div>
  )
}

interface SliderMark {
  index: number
  label: string
  tone: 'plan' | 'safe'
}

const MARK_DOT = { plan: 'bg-fg-muted', safe: 'bg-success' } as const

// The thumb is 16px wide, so a step's position runs from 8px to 100% − 8px.
const markLeft = (index: number, count: number) => `calc(8px + (100% - 16px) * ${count > 1 ? index / (count - 1) : 0})`

function ScenarioSlider({ label, value, unit, detail, index, count, onChange, ariaLabel, ariaValueText, ends, marks, footer }: {
  label: string
  value: ReactNode
  unit?: string
  detail: string
  index: number
  count: number
  onChange: (index: number) => void
  ariaLabel: string
  ariaValueText: string
  ends: [string, string]
  marks: SliderMark[]
  footer?: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col bg-surface p-4 sm:p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-fg tabular-nums">
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-fg-muted">{unit}</span>}
      </p>
      <p className="text-xs text-fg-secondary">{detail}</p>

      <div className="relative mt-4">
        <input
          type="range"
          min={0}
          max={count - 1}
          value={index}
          onChange={e => onChange(Number(e.target.value))}
          className="relative z-10 h-5 w-full"
          aria-label={ariaLabel}
          aria-valuetext={ariaValueText}
        />
        {marks.map(m => (
          <span
            key={m.tone}
            aria-hidden
            className={cn('absolute top-[calc(100%+1px)] h-1.5 w-1.5 -translate-x-1/2 rounded-full', MARK_DOT[m.tone])}
            style={{ left: markLeft(m.index, count) }}
          />
        ))}
      </div>
      <div className="mt-2.5 flex justify-between text-xs tabular-nums text-fg-muted">
        <span>{ends[0]}</span>
        <span>{ends[1]}</span>
      </div>

      {marks.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {marks.map(m => (
            <button
              key={m.tone}
              type="button"
              onClick={() => onChange(m.index)}
              aria-pressed={m.index === index}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors',
                m.index === index ? 'border-border-strong bg-surface-muted text-fg' : 'border-border text-fg-secondary hover:bg-surface-muted hover:text-fg',
              )}
            >
              <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', MARK_DOT[m.tone])} />
              {m.label}
            </button>
          ))}
        </div>
      )}

      {footer && <div className="mt-auto pt-3 text-xs text-fg-muted">{footer}</div>}
    </div>
  )
}

function spendingLimitText(result: SpendingAtAge, base: number): string {
  if (result.highestSafeIndex === null) {
    return `Even ${Math.abs(SPENDING_STEPS_PCT[0])}% less isn’t safe at this age.`
  }
  const limit = SPENDING_STEPS_PCT[result.highestSafeIndex]
  const amount = base > 0 ? `${money(spendingAt(base, limit))} a year` : null
  if (result.highestSafeIndex === SPENDING_STEPS_PCT.length - 1) {
    return `Still safe at ${limit}% more${amount ? ` (${amount})` : ''}, the most tested.`
  }
  const words = limit === 0 ? 'your current spending' : `${Math.abs(limit)}% ${limit < 0 ? 'less' : 'more'}`
  return `Safe at this age up to ${words}${amount ? ` (${amount})` : ''}.`
}

function TimingExplorer({ timing, onApply, onCopy }: {
  timing: RetirementTiming
  onApply: (p: Proposal) => void
  onCopy: (p: Proposal) => void
}) {
  const { options, currentIndex, safestIndex, bestIndex, runs } = timing
  const [picked, setPicked] = useState<number | null>(null)
  const [spendIndex, setSpendIndex] = useState(PLAN_SPENDING_INDEX)
  const index = picked ?? safestIndex ?? bestIndex
  const option = options[index]
  const spendPct = SPENDING_STEPS_PCT[spendIndex]
  const spending = useSpendingAtAge(option.shift)
  const levels = spending.result?.shift === option.shift ? spending.result : undefined

  // The plan's own spending at this age is already scored by the age job.
  const tested = spendPct === 0 ? { safe: option.safe, score: option.score } : levels?.options[spendIndex] ?? null
  const isCurrent = index === currentIndex && spendPct === 0
  const base = options[currentIndex].score
  const baseSpending = option.score.spending

  const changes = timingChanges(option.shift, spendPct)
  const described = changes.map(describeChange)
  const proposal: Proposal | null = tested && changes.length > 0
    ? {
        id: `timing-${option.shift}-${spendPct}`,
        group: 'tradeoff',
        title: described.map(d => d.title).join(' · '),
        detail: described.map(d => d.detail).join(' '),
        changes,
        score: tested.score,
      }
    : null

  const reset = () => {
    setPicked(currentIndex)
    setSpendIndex(PLAN_SPENDING_INDEX)
  }

  const ageMarks: SliderMark[] = [{ index: currentIndex, label: `Your plan: ${ageLabel(options[currentIndex])}`, tone: 'plan' }]
  if (safestIndex !== null && safestIndex !== currentIndex) ageMarks.push({ index: safestIndex, label: `Earliest safe: ${ageLabel(options[safestIndex])}`, tone: 'safe' })

  const spendMarks: SliderMark[] = [{ index: PLAN_SPENDING_INDEX, label: 'Your plan', tone: 'plan' }]
  if (levels?.highestSafeIndex != null && levels.highestSafeIndex !== PLAN_SPENDING_INDEX) {
    spendMarks.push({ index: levels.highestSafeIndex, label: 'Most that’s safe', tone: 'safe' })
  }

  const spendValue = baseSpending > 0 ? money(spendingAt(baseSpending, spendPct)) : pctWords(spendPct)
  const status = tested ? verdict(tested) : null

  return (
    <div className="space-y-5">
      <Headline timing={timing} />

      <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-2">
        {options.length > 1
          ? (
              <ScenarioSlider
                label="Retirement age"
                value={ageLabel(option)}
                detail={shiftWords(option.shift)}
                index={index}
                count={options.length}
                onChange={setPicked}
                ariaLabel="Retirement age to try"
                ariaValueText={`Retire at ${ageLabel(option)}. ${shiftWords(option.shift)}.`}
                ends={[ageLabel(options[0]), ageLabel(options[options.length - 1])]}
                marks={ageMarks}
              />
            )
          : (
              <div className="bg-surface p-4 sm:p-5">
                <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">Retirement age</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight text-fg">{ageLabel(option)}</p>
                <p className="text-xs text-fg-secondary">The only age that can be tested.</p>
              </div>
            )}
        <ScenarioSlider
          label="Yearly spending"
          value={spendValue}
          unit={baseSpending > 0 ? 'a year' : undefined}
          detail={pctWords(spendPct)}
          index={spendIndex}
          count={SPENDING_STEPS_PCT.length}
          onChange={setSpendIndex}
          ariaLabel="Change in yearly spending to try"
          ariaValueText={`${baseSpending > 0 ? `${spendValue} a year. ` : ''}${pctWords(spendPct)}.`}
          ends={[`${SPENDING_STEPS_PCT[0]}%`, `+${SPENDING_STEPS_PCT[SPENDING_STEPS_PCT.length - 1]}%`]}
          marks={spendMarks}
          footer={spending.error
            ? <span className="text-danger">{spending.error}</span>
            : spending.done && levels
              ? spendingLimitText(levels, baseSpending)
              : `Testing spending at ${ageLabel(option)}…`}
        />
      </div>

      <section aria-live="polite" aria-label="Result of this scenario">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-fg">
            {isCurrent ? 'Your plan as it is' : described.map(d => d.title).join(' · ')}
          </p>
          {status && <Badge tone={status.tone}>{status.text}</Badge>}
        </div>
        {tested
          ? (
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-5">
                {impactRows(base, tested.score).map(({ value, delta }, i, rows) => (
                  <div key={delta.label} className={cn('min-w-0 bg-surface px-4 py-3', rows.length % 2 === 1 && i === 0 && 'col-span-2 lg:col-span-1')}>
                    <dt className="truncate text-xs text-fg-muted">{delta.label}</dt>
                    <dd className="mt-0.5 text-lg font-semibold tabular-nums text-fg">{value}</dd>
                    <dd className={cn('text-xs font-medium', TONE[isCurrent ? 'none' : delta.tone])}>{isCurrent ? 'Your plan' : delta.text}</dd>
                  </div>
                ))}
              </dl>
            )
          : (
              <div className="rounded-xl border border-border px-4 py-5">
                <TestingProgress label="Testing this spending level…" progress={spending.progress ?? 0} />
              </div>
            )}
      </section>

      {!isCurrent && (
        <div className="flex flex-wrap items-center gap-2">
          {proposal && (
            <>
              <Button size="sm" icon={Copy} onClick={() => onCopy(proposal)}>Try as a new plan</Button>
              <Button size="sm" variant="ghost" icon={Check} onClick={() => onApply(proposal)}>Apply to this plan</Button>
            </>
          )}
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={reset} className="sm:ml-auto">Back to your plan</Button>
        </div>
      )}

      <p className="text-xs text-fg-muted">
        Each point tested on {runs.toLocaleString('en-CA')} simulated markets. Pay and contributions that end at retirement move with the age you pick.
        Spending changes apply to recurring spending; one-time costs and gifts stay as they are. Amounts are in today’s dollars, for the first year of retirement.
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
        description={`The earliest age with at least a ${TARGET_PCT}% chance of success that also reaches your goal. Move both sliders to see how spending less or more changes it.`}
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
