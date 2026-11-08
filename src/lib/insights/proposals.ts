import { ACCOUNT_TYPES, GIFT_CATEGORY, type AccountType, type PlanV2 } from '@/lib/plan/schema'
import { compilePlan } from '@/lib/sim/compile'
import { simulate } from '@/lib/sim/simulate'
import { deterministicPath } from '@/lib/sim/paths/deterministic'
import { runMonteCarloBatch, settingsFromPlan, successIsMeaningful } from '@/lib/sim/risk'
import { planMetrics } from './compare'
import { planGoalOutlook } from './outlook'
import { money } from '@/lib/formatting'

// Proposals: changes to a plan, each tested by re-running the whole plan with
// the change applied. Nothing here relies on rules of thumb. A change is shown
// only when the simulation says it beats the current plan.

// The success rate the trade-offs aim for.
export const TARGET_SUCCESS = 0.9
// Every run of a proposal uses the same simulated markets as the baseline, but
// differences smaller than this are still too small to act on.
const MIN_SUCCESS_GAIN = 0.01
const MAX_SUCCESS_LOSS = 0.01
const MIN_MONEY_GAIN = 10_000
const MIN_RELATIVE_GAIN = 0.01
// Each proposal needs its own Monte Carlo, so a very large run count in the
// plan's settings is capped to keep the page responsive.
export const PROPOSAL_MAX_RUNS = 1000

export type Change =
  | { kind: 'withdrawalOrder'; order: 'proRata' }
  | { kind: 'withdrawalOrder'; order: 'custom'; customOrder: AccountType[]; label: string }
  | { kind: 'meltdown'; enabled: boolean; targetTaxableIncome: number }
  | { kind: 'benefitStart'; cppAge: number; oasAge: number }
  | { kind: 'rrifConversion'; age: number }
  // Positive is later, negative earlier.
  | { kind: 'retirementShift'; years: number }
  // Percent change in recurring spending; negative is less.
  | { kind: 'spending'; pct: number }
  | { kind: 'saving'; annual: number; accountId: string; accountLabel: string }

export interface PlanScore {
  // Null when the plan has nothing for Monte Carlo to test.
  successRate: number | null
  onTrack: boolean
  funded: boolean
  goalProgressPct: number
  lifetimeTax: number
  afterTaxEstate: number
  averageIncome: number
}

export type ProposalGroup = 'combo' | 'free' | 'tradeoff' | 'spare'

export interface Proposal {
  id: string
  group: ProposalGroup
  title: string
  detail: string
  changes: Change[]
  score: PlanScore
  // Trade-offs only: false means the largest change tested still fell short.
  reachesTarget?: boolean
}

export interface ProposalUpdate {
  base: PlanScore
  proposals: Proposal[]
  tested: number
  runs: number
  progress: number // 0..1
  done: boolean
}

// --- Applying changes ---------------------------------------------------------

function personAge(birthYear: number, nowYear: number) {
  return nowYear - birthYear
}

function applyChange(plan: PlanV2, change: Change, nowYear: number): PlanV2 {
  switch (change.kind) {
    case 'withdrawalOrder':
      return {
        ...plan,
        drawdown: {
          ...plan.drawdown,
          order: change.order,
          customOrder: change.order === 'custom' ? change.customOrder : plan.drawdown.customOrder,
        },
      }
    case 'meltdown':
      return { ...plan, drawdown: { ...plan.drawdown, meltdown: { enabled: change.enabled, targetTaxableIncome: change.targetTaxableIncome } } }
    case 'rrifConversion':
      return { ...plan, drawdown: { ...plan.drawdown, rrifConversionAge: change.age } }
    case 'benefitStart':
      return {
        ...plan,
        people: plan.people.map(p => {
          const age = personAge(p.birthYear, nowYear)
          // A benefit already being paid can't be restarted, and a start age
          // in the past can't be chosen.
          const start = (current: number, wanted: number) => (age < current && wanted >= age ? wanted : current)
          return { ...p, cppStartAge: start(p.cppStartAge, change.cppAge), oas: { ...p.oas, startAge: start(p.oas.startAge, change.oasAge) } }
        }),
      }
    case 'retirementShift':
      return {
        ...plan,
        people: plan.people.map(p => {
          const age = personAge(p.birthYear, nowYear)
          if (age >= p.retirementAge) return p
          return { ...p, retirementAge: Math.max(age + 1, Math.min(p.lifeExpectancy - 1, p.retirementAge + change.years)) }
        }),
      }
    case 'spending': {
      const factor = 1 + change.pct / 100
      const strategy = plan.drawdown.strategy
      // In simple mode the withdrawal rate is the spending decision: the
      // replacement target only sets the goal.
      const scaledStrategy = plan.expenses.mode === 'simple' && strategy.kind === 'initialPct'
        ? { ...strategy, ratePct: Math.min(20, Math.max(0.01, strategy.ratePct * factor)) }
        : strategy
      return {
        ...plan,
        drawdown: { ...plan.drawdown, strategy: scaledStrategy },
        expenses: {
          ...plan.expenses,
          replacementRate: Math.min(200, plan.expenses.replacementRate * factor),
          items: plan.expenses.items.map(item => (
            item.frequency === 'oneTime' || item.category === GIFT_CATEGORY ? item : { ...item, amount: Math.round(item.amount * factor) }
          )),
        },
      }
    }
    case 'saving':
      return {
        ...plan,
        accounts: plan.accounts.map(a => (
          a.id === change.accountId ? { ...a, contributions: [...a.contributions, { amount: change.annual, indexed: true }] } : a
        )),
      }
  }
}

export function applyChanges(plan: PlanV2, changes: Change[], nowYear: number): PlanV2 {
  return changes.reduce((next, change) => applyChange(next, change, nowYear), plan)
}

// --- Describing changes -------------------------------------------------------

export function describeChange(change: Change): { title: string; detail: string } {
  switch (change.kind) {
    case 'withdrawalOrder':
      return change.order === 'proRata'
        ? { title: 'Withdraw from all accounts evenly', detail: 'Take each year’s withdrawal from every account in proportion to its balance.' }
        : { title: `Withdraw ${change.label}`, detail: `Use accounts in this order: ${change.customOrder.join(', ')}.` }
    case 'meltdown':
      return change.enabled
        ? {
            title: `Melt down your RRSP to ${money(change.targetTaxableIncome)} of income`,
            detail: `In retirement, draw extra from RRSP/RRIF each year until taxable income reaches ${money(change.targetTaxableIncome)} (today’s dollars), and reinvest what is left after tax.`,
          }
        : { title: 'Turn off the RRSP meltdown', detail: 'Withdraw from RRSP/RRIF only what your strategy needs and what the rules require.' }
    case 'benefitStart':
      return { title: `Start CPP at ${change.cppAge} and OAS at ${change.oasAge}`, detail: 'Applied to everyone in the plan who has not started these benefits yet.' }
    case 'rrifConversion':
      return { title: `Convert your RRSP to a RRIF at ${change.age}`, detail: 'Minimum withdrawals start at that age, and RRIF income qualifies for the pension credit and pension splitting from 65.' }
    case 'retirementShift': {
      const n = Math.abs(change.years)
      const years = `${n} year${n === 1 ? '' : 's'}`
      return change.years > 0
        ? { title: `Retire ${years} later`, detail: 'Salary and contributions that end at retirement continue for that time.' }
        : { title: `Retire ${years} earlier`, detail: 'Salary and contributions that end at retirement stop sooner.' }
    }
    case 'spending':
      return change.pct < 0
        ? { title: `Spend ${Math.abs(change.pct)}% less`, detail: 'Lowers recurring spending. One-time costs and gifts stay as they are.' }
        : { title: `Spend ${change.pct}% more`, detail: 'Raises recurring spending. One-time costs and gifts stay as they are.' }
    case 'saving':
      return { title: `Save ${money(change.annual)} more a year`, detail: `Added to ${change.accountLabel} until retirement, rising with inflation.` }
  }
}

// --- Choosing what to test ----------------------------------------------------

const ORDER_PRESETS: { label: string; order: AccountType[]; needs: AccountType[] }[] = [
  { label: 'stock first', order: ['STOCK', 'CASH', 'NONREG', 'RRIF', 'RRSP', 'LIF', 'LIRA', 'FHSA', 'TFSA'], needs: ['STOCK'] },
  { label: 'non-registered first, TFSA last', order: ['CASH', 'STOCK', 'NONREG', 'RRIF', 'RRSP', 'LIF', 'LIRA', 'FHSA', 'TFSA'], needs: [] },
  { label: 'RRSP first, TFSA last', order: ['RRIF', 'RRSP', 'LIF', 'LIRA', 'CASH', 'STOCK', 'NONREG', 'FHSA', 'TFSA'], needs: [] },
]
const MELTDOWN_TARGETS = [50_000, 60_000, 80_000, 100_000]
const BENEFIT_AGES: [cpp: number, oas: number][] = [[60, 65], [65, 65], [70, 65], [65, 70], [70, 70]]
const RRIF_AGES = [65, 71]
const RETIRE_LATER_YEARS = [1, 2, 3, 4, 5]
const SPEND_LESS_PCT = [5, 10, 15, 20, 25]
const SPEND_MORE_PCT = [5, 10, 15, 20, 30, 40, 50]
const SAVE_MORE = [1_200, 2_400, 5_000, 7_500, 10_000, 15_000, 20_000]

function orderChanges(plan: PlanV2): Change[] {
  const owned = new Set(plan.accounts.map(a => a.type))
  if (owned.size < 2) return []
  // Two orders that rank the plan's own accounts the same are the same test.
  const effective = (order: AccountType[]) => order.filter(t => owned.has(t)).join()
  const current = plan.drawdown.order === 'custom' ? effective(plan.drawdown.customOrder) : 'proRata'
  const seen = new Set([current])
  const out: Change[] = plan.drawdown.order === 'custom' ? [{ kind: 'withdrawalOrder', order: 'proRata' }] : []
  for (const preset of ORDER_PRESETS) {
    if (!preset.needs.every(t => owned.has(t))) continue
    const key = effective(preset.order)
    if (seen.has(key)) continue
    seen.add(key)
    // A saved order must list every type; the schema relies on it.
    const customOrder = [...preset.order, ...ACCOUNT_TYPES.filter(t => !preset.order.includes(t))]
    out.push({ kind: 'withdrawalOrder', order: 'custom', customOrder, label: preset.label })
  }
  return out
}

function meltdownChanges(plan: PlanV2): Change[] {
  const hasRegistered = plan.accounts.some(a => a.type === 'RRSP' || a.type === 'RRIF')
  if (!hasRegistered) return []
  const { enabled, targetTaxableIncome } = plan.drawdown.meltdown
  const out: Change[] = MELTDOWN_TARGETS
    .filter(target => !enabled || target !== targetTaxableIncome)
    .map(target => ({ kind: 'meltdown', enabled: true, targetTaxableIncome: target }))
  if (enabled) out.push({ kind: 'meltdown', enabled: false, targetTaxableIncome })
  return out
}

function benefitChanges(plan: PlanV2, nowYear: number): Change[] {
  return BENEFIT_AGES
    .map(([cppAge, oasAge]): Change => ({ kind: 'benefitStart', cppAge, oasAge }))
    .filter(change => JSON.stringify(applyChange(plan, change, nowYear).people) !== JSON.stringify(plan.people))
}

function rrifChanges(plan: PlanV2, nowYear: number): Change[] {
  const owners = new Set(plan.accounts.filter(a => a.type === 'RRSP').map(a => a.ownerId))
  const youngest = Math.min(...plan.people.filter(p => owners.has(p.id) || owners.has('joint')).map(p => personAge(p.birthYear, nowYear)))
  return RRIF_AGES
    .filter(age => age !== plan.drawdown.rrifConversionAge && youngest < age)
    .map(age => ({ kind: 'rrifConversion', age }))
}

function savingTarget(plan: PlanV2) {
  // Non-registered first: it has no room limit that could quietly cap the
  // amount proposed.
  for (const type of ['NONREG', 'CASH', 'TFSA', 'RRSP'] as const) {
    const account = plan.accounts.find(a => a.type === type)
    if (account) return { id: account.id, label: account.label || type }
  }
  return null
}

// --- Comparing results --------------------------------------------------------

function isImprovement(base: PlanScore, s: PlanScore): boolean {
  if (base.funded && !s.funded) return false
  if (base.onTrack && !s.onTrack) return false
  const success = (s.successRate ?? 0) - (base.successRate ?? 0)
  if (success < -MAX_SUCCESS_LOSS) return false
  const estateGain = s.afterTaxEstate - base.afterTaxEstate
  const incomeGain = s.averageIncome - base.averageIncome
  return success >= MIN_SUCCESS_GAIN
    || (!base.onTrack && s.onTrack)
    || estateGain >= Math.max(MIN_MONEY_GAIN, base.afterTaxEstate * MIN_RELATIVE_GAIN)
    || incomeGain >= base.averageIncome * MIN_RELATIVE_GAIN
}

// Plans short of the target care about success first; plans already past it
// care about what is left over.
function compareScores(a: PlanScore, b: PlanScore, focusOnSuccess: boolean): number {
  // About a retirement's worth of income, so income and estate gains compare.
  const wealth = (s: PlanScore) => s.afterTaxEstate + s.averageIncome * 25
  if (focusOnSuccess) {
    const bucket = (s: PlanScore) => Math.round((s.successRate ?? 0) * 100)
    if (bucket(a) !== bucket(b)) return bucket(a) - bucket(b)
  }
  return wealth(a) - wealth(b)
}

export function meetsTarget(s: PlanScore, needGoal: boolean): boolean {
  return (s.successRate === null || s.successRate >= TARGET_SUCCESS) && (!needGoal || s.onTrack)
}

// --- The job ------------------------------------------------------------------

// Scores variations of `plan`. Every candidate gets the plan's own simulated
// markets, so any difference between two scores comes from the change.
export function createScorer(plan: PlanV2, startYear: number, maxRuns = PROPOSAL_MAX_RUNS) {
  const settings = settingsFromPlan(plan)
  const runs = Math.min(settings.runs, maxRuns)
  const score = (candidate: PlanV2): PlanScore => {
    const c = compilePlan(candidate, { startYear })
    const result = simulate(c, deterministicPath(c.years, c.expectedReturnPct, c.inflationPct))
    const metrics = planMetrics(candidate, c, result)
    const { outlook } = planGoalOutlook(candidate, c, result, startYear)
    const successRate = successIsMeaningful(c, result)
      ? runMonteCarloBatch(c, settings, settings.seed, 0, runs).successes / Math.max(1, runs)
      : null
    return {
      successRate,
      onTrack: outlook.onTrack,
      funded: metrics.onTrack,
      goalProgressPct: outlook.progressPct,
      lifetimeTax: metrics.lifetimeTax,
      afterTaxEstate: metrics.afterTaxEstate,
      averageIncome: metrics.averageRetirementIncome,
    }
  }
  return { score, runs }
}

export async function runProposalJob(
  plan: PlanV2,
  startYear: number,
  onUpdate: (update: ProposalUpdate) => void,
  opts: { maxRuns?: number; shouldStop?: () => boolean; yieldBetween?: () => Promise<void> } = {},
): Promise<void> {
  const { score, runs } = createScorer(plan, startYear, opts.maxRuns)
  let tested = 0

  const base = score(plan)
  const focusOnSuccess = (base.successRate !== null && base.successRate < TARGET_SUCCESS) || !base.onTrack
  const proposals: Proposal[] = []

  const free = [orderChanges(plan), meltdownChanges(plan), benefitChanges(plan, startYear), rrifChanges(plan, startYear)]
  const savings = savingTarget(plan)
  const canShiftRetirement = plan.people.some(p => personAge(p.birthYear, startYear) < p.retirementAge)
  // Enough for a progress bar; the trade-off searches usually stop early.
  const expected = 1 + free.flat().length + 3 + 12

  const publish = (done: boolean) => onUpdate({
    base,
    proposals: [...proposals],
    tested,
    runs,
    progress: done ? 1 : Math.min(0.99, (tested + 1) / expected),
    done,
  })
  publish(false)

  // Returns null when a newer request has replaced this job.
  const test = async (changes: Change[]): Promise<PlanScore | null> => {
    if (opts.shouldStop?.()) return null
    const result = score(applyChanges(plan, changes, startYear))
    tested++
    publish(false)
    if (opts.yieldBetween) await opts.yieldBetween()
    return result
  }

  // Free changes: the best worthwhile option in each dimension.
  const bestPerDimension: { change: Change; score: PlanScore }[] = []
  for (const dimension of free) {
    let best: { change: Change; score: PlanScore } | null = null
    for (const change of dimension) {
      const s = await test([change])
      if (!s) return
      if (isImprovement(base, s) && (!best || compareScores(s, best.score, focusOnSuccess) > 0)) best = { change, score: s }
    }
    if (best) {
      bestPerDimension.push(best)
      const { title, detail } = describeChange(best.change)
      proposals.push({ id: `free-${proposals.length}`, group: 'free', title, detail, changes: [best.change], score: best.score })
      proposals.sort((a, b) => compareScores(b.score, a.score, focusOnSuccess))
      publish(false)
    }
  }

  // Changes interact (a meltdown changes what withdrawal order is worth), so
  // the combination is built one step at a time, keeping only what still helps.
  const ranked = [...bestPerDimension].sort((a, b) => compareScores(b.score, a.score, focusOnSuccess))
  if (ranked.length > 1) {
    const accepted = [ranked[0].change]
    let current = ranked[0].score
    for (const next of ranked.slice(1)) {
      const s = await test([...accepted, next.change])
      if (!s) return
      if (isImprovement(current, s) && compareScores(s, current, focusOnSuccess) > 0) {
        accepted.push(next.change)
        current = s
      }
    }
    if (accepted.length > 1) {
      proposals.unshift({
        id: 'combo',
        group: 'combo',
        title: 'Best combination',
        detail: accepted.map(change => describeChange(change).title).join(' · '),
        changes: accepted,
        score: current,
      })
      publish(false)
    }
  }

  const needGoal = !base.onTrack

  if (focusOnSuccess) {
    // Trade-offs: the smallest change that gets there, or the largest tested
    // if nothing does and it still helps.
    const levers: Change[][] = [
      canShiftRetirement ? RETIRE_LATER_YEARS.map(years => ({ kind: 'retirementShift', years })) : [],
      SPEND_LESS_PCT.map(pct => ({ kind: 'spending', pct: -pct })),
      savings && canShiftRetirement
        ? SAVE_MORE.map(annual => ({ kind: 'saving', annual, accountId: savings.id, accountLabel: savings.label }))
        : [],
    ]
    for (const lever of levers) {
      let last: { change: Change; score: PlanScore } | null = null
      let reached = false
      for (const change of lever) {
        const s = await test([change])
        if (!s) return
        last = { change, score: s }
        if (meetsTarget(s, needGoal)) {
          reached = true
          break
        }
      }
      if (last && (reached || isImprovement(base, last.score))) {
        const { title, detail } = describeChange(last.change)
        proposals.push({ id: `tradeoff-${proposals.length}`, group: 'tradeoff', title, detail, changes: [last.change], score: last.score, reachesTarget: reached })
        publish(false)
      }
    }
  } else {
    // Already past the target: how far could the plan go and stay there?
    const levers: Change[][] = [
      canShiftRetirement ? RETIRE_LATER_YEARS.map(years => ({ kind: 'retirementShift', years: -years })) : [],
      SPEND_MORE_PCT.map(pct => ({ kind: 'spending', pct })),
    ]
    for (const lever of levers) {
      let last: { change: Change; score: PlanScore } | null = null
      for (const change of lever) {
        const s = await test([change])
        if (!s) return
        if (!meetsTarget(s, true) || !s.funded) break
        last = { change, score: s }
      }
      if (last) {
        const { title, detail } = describeChange(last.change)
        proposals.push({ id: `spare-${proposals.length}`, group: 'spare', title, detail, changes: [last.change], score: last.score })
        publish(false)
      }
    }
  }

  publish(true)
}
