import { isRealDate } from '@/lib/plan/diagnostics'
import { useMemo, useState } from 'react'
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts'
import { History, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { useProjectionContext } from '@/contexts/ProjectionContext'
import { patchAccount } from '@/lib/plan/edits'
import { isoDate } from '@/lib/plan/defaults'
import { newId } from '@/lib/plan/ids'
import { ACCOUNT_LABELS } from '@/lib/plan/accountGroups'
import { money, moneyCompact } from '@/lib/formatting'
import { axisProps, chartColors, gridProps, tooltipProps } from '@/lib/ui/chartTheme'
import { table } from '@/lib/ui/styles'
import { cn } from '@/lib/ui/cn'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardHeader } from '@/components/ui/Card'
import { MoneyModeBadge } from '@/components/ui/Badge'
import { Button, IconButton } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { Field } from '@/components/ui/Field'
import { TextInput } from '@/components/ui/inputs'
import { NumberInput } from '@/components/ui/NumberInput'
import { Checkbox } from '@/components/ui/Checkbox'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { ChartLegend } from '@/components/ui/ChartLegend'

function fractionalYear(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return y + ((m - 1) * 30.4 + (d - 1)) / 365
}

// Record actual balances over time and compare them with a saved projection.
export function TrackingView() {
  const { activePlan, snapshots, baselines, deleteSnapshot, setBaseline, now } = usePlanStore()
  const { simulation } = useProjectionContext()
  const [recording, setRecording] = useState(false)

  const planSnapshots = snapshots.filter(s => s.planId === activePlan.id)
  const baseline = baselines.find(b => b.planId === activePlan.id)

  const saveBaseline = () => setBaseline({
    planId: activePlan.id,
    date: isoDate(now),
    // Start-of-year balances, nominal, so they line up with dated snapshots.
    portfolio: simulation.rows.map(r => ({ year: r.year, value: r.balancesStart.reduce((s, b) => s + b, 0) })),
  })

  const chartData = useMemo(() => {
    const projected = (baseline?.portfolio ?? []).slice(0, 25).map(p => ({ x: p.year, projected: p.value }))
    const actual = planSnapshots.map(s => ({ x: fractionalYear(s.date), actual: s.total }))
    return [...projected, ...actual].sort((a, b) => a.x - b.x)
  }, [baseline, planSnapshots])

  const latest = planSnapshots.at(-1)
  const expectedNow = latest && baseline
    ? (() => {
        const x = fractionalYear(latest.date)
        const y0 = Math.floor(x)
        const a = baseline.portfolio.find(p => p.year === y0)
        const b = baseline.portfolio.find(p => p.year === y0 + 1)
        if (!a) return null
        return b ? a.value + (b.value - a.value) * (x - y0) : a.value
      })()
    : null
  const diff = latest && expectedNow !== null ? latest.total - expectedNow : null

  return (
    <>
      <PageHeader
        title="Tracking"
        description="Every few months, record what your accounts are worth to see whether you are ahead of or behind your plan."
        meta={<MoneyModeBadge mode="fixedNominal" />}
        actions={<Button variant="primary" size="sm" icon={Plus} onClick={() => setRecording(true)} disabled={activePlan.accounts.length === 0}>Record balances</Button>}
      />

      {planSnapshots.length === 0 ? (
        <Card>
          <EmptyState
            icon={History}
            title="No balances recorded yet"
            description="Your first snapshot also saves today's projection, so later snapshots can be compared with it."
            action={<Button variant="primary" icon={Plus} onClick={() => setRecording(true)} disabled={activePlan.accounts.length === 0}>Record balances</Button>}
          />
        </Card>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat label={`Balance on ${latest!.date}`} value={money(latest!.total)} />
            <Stat label="Projected for that date" value={expectedNow === null ? '—' : money(expectedNow)} sub={baseline ? `Projection saved ${baseline.date}` : undefined} />
            <Stat
              label={diff === null ? 'Difference' : diff >= 0 ? 'Ahead of plan' : 'Behind plan'}
              value={diff === null ? '—' : money(Math.abs(diff))}
              tone={diff === null ? 'default' : diff >= 0 ? 'success' : 'warning'}
            />
          </div>

          <Card>
            <CardHeader
              title="Actual vs. projected"
              description="Total of all accounts, in the dollars of each date."
              actions={<Button size="sm" icon={RefreshCw} onClick={saveBaseline}>{baseline ? 'Rebaseline to current plan' : 'Save projection'}</Button>}
            />
            <ChartLegend
              className="mb-3"
              items={[{ label: 'Projected', color: chartColors.base, shape: 'line' }, { label: 'Recorded', color: chartColors.total }]}
            />
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(v) => String(Math.floor(v))} allowDecimals={false} {...axisProps} />
                  <YAxis {...axisProps} width={60} tickFormatter={(v: number) => moneyCompact(v)} />
                  <Tooltip
                    {...tooltipProps}
                    labelFormatter={(v) => String(Math.floor(Number(v)))}
                    formatter={(value, name) => [money(Number(value)), name === 'actual' ? 'Recorded' : 'Projected']}
                  />
                  <Line dataKey="projected" stroke={chartColors.base} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                  <Scatter dataKey="actual" fill={chartColors.total} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card padding="none">
            <div className="p-4 sm:p-5"><CardHeader className="mb-0" title="History" /></div>
            <div className="overflow-x-auto border-t border-border">
              <table className={cn(table.table, 'min-w-[420px]')}>
                <thead className={table.thead}>
                  <tr><th className={table.th}>Date</th><th className={table.th}>Total</th><th className={table.th}>Change</th><th className={table.th}><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {planSnapshots.map((s, i) => {
                    const prev = planSnapshots[i - 1]
                    return (
                      <tr key={s.id} className={table.tr}>
                        <td className={cn(table.td, 'font-medium text-fg')}>{s.date}</td>
                        <td className={table.td}>{money(s.total)}</td>
                        <td className={table.td}>{prev ? `${s.total >= prev.total ? '+' : ''}${money(s.total - prev.total)}` : '—'}</td>
                        <td className={cn(table.td, 'py-1')}>
                          <IconButton icon={Trash2} size="sm" label={`Delete snapshot from ${s.date}`} onClick={() => deleteSnapshot(s.id)} className="text-fg-muted hover:text-danger" />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      <Sheet open={recording} onClose={() => setRecording(false)} title="Record balances" description="What each account is worth on the date below.">
        {recording && <RecordForm onDone={() => setRecording(false)} hasBaseline={!!baseline} saveBaseline={saveBaseline} />}
      </Sheet>
    </>
  )
}

function RecordForm({ onDone, hasBaseline, saveBaseline }: { onDone: () => void; hasBaseline: boolean; saveBaseline: () => void }) {
  const { activePlan, updateActivePlan, addSnapshot, now } = usePlanStore()
  const [date, setDate] = useState(() => isoDate(now))
  const [draft, setDraft] = useState<Record<string, number>>(() => Object.fromEntries(activePlan.accounts.map(a => [a.id, a.balance])))
  const [updatePlan, setUpdatePlan] = useState(true)
  const people = new Map(activePlan.people.map(p => [p.id, p.name]))
  const multi = activePlan.people.length > 1
  const validDate = isRealDate(date)
  // Projections start this calendar year, so only a balance from this year
  // can stand in for the opening amount.
  const canUpdatePlan = validDate && Number(date.slice(0, 4)) === now.getFullYear()

  const save = () => {
    const balances = Object.fromEntries(activePlan.accounts.map(a => [a.id, draft[a.id] ?? a.balance]))
    const total = Object.values(balances).reduce((s, v) => s + v, 0)
    if (!hasBaseline) saveBaseline()
    addSnapshot({ id: newId('snapshot'), planId: activePlan.id, date, balances, total })
    if (updatePlan && canUpdatePlan) {
      updateActivePlan(p => {
        let next = { ...p, asOf: date }
        // A stock account's value comes from its shares and price, so a typed
        // balance is an observation only.
        for (const account of p.accounts) {
          if (account.type !== 'STOCK') next = patchAccount(next, account.id, { balance: balances[account.id] })
        }
        return next
      })
    }
    onDone()
  }

  return (
    <div className="space-y-5">
      <Field label="Date">
        <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <div className="space-y-4 border-t border-border pt-5">
        {activePlan.accounts.map(a => (
          <Field
            key={a.id}
            label={`${multi ? `${people.get(a.ownerId) ?? 'Joint'} · ` : ''}${a.label || ACCOUNT_LABELS[a.type]}`}
            hint={a.type === 'STOCK' ? 'Recorded for comparison only. To change projections, update shares and prices under Savings.' : undefined}
          >
            <NumberInput value={draft[a.id] ?? a.balance} min={0} onChange={(v) => setDraft(d => ({ ...d, [a.id]: v }))} />
          </Field>
        ))}
      </div>
      {canUpdatePlan ? (
        <Checkbox checked={updatePlan} onChange={setUpdatePlan} label="Also update the plan's balances" description="Projections then start from these amounts." />
      ) : (
        <p className="text-xs text-fg-muted">This date isn't in the current year, so it is recorded as history and the plan's balances stay as they are.</p>
      )}
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button onClick={onDone}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={!validDate}>Save snapshot</Button>
      </div>
    </div>
  )
}
