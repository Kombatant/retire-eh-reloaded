import { useState } from 'react'
import { ChevronDown, ChevronRight, RefreshCw, X } from 'lucide-react'
import { usePlanStore } from '@/contexts/PlanStoreContext'
import { useStockQuotes } from '@/hooks/useStockQuotes'
import { addHolding, patchHolding, removeHolding, setStockSalePlan, setStockScenario, setUsdCad } from '@/lib/plan/edits'
import { newId } from '@/lib/plan/ids'
import { DEFAULT_USD_CAD, STOCK_SCENARIOS, type AccountV2, type Holding, type RsuGrant, type StockScenario } from '@/lib/plan/schema'
import { QUOTE_PROVIDERS, isStale, type QuoteProvider } from '@/lib/market/quotes'
import { formatMoney } from '@/lib/formatting'
import { NumberInput } from '@/components/ui/NumberInput'
import { DecimalInput } from '@/components/ui/inputs'
import { TimePointPicker } from '@/components/ui/TimePointPicker'
import { InfoTooltip } from '@/components/ui/InfoTooltip'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { controlBase, controlSize, labelClass as sharedLabelClass } from '@/lib/ui/styles'

type StockAccount = Extract<AccountV2, { type: 'STOCK' }>

const labelClass = `${sharedLabelClass} mb-1.5`
const inputClass = `${controlBase} ${controlSize.md}`
const SCENARIO_LABELS: Record<StockScenario, string> = { bear: 'Bear', base: 'Base', bull: 'Bull' }

// Shares, percentages and other plain numbers; decimals are allowed.
function numberField(value: number, onChange: (v: number) => void, props: { min?: number; max?: number; label: string }) {
  return <DecimalInput value={value} onChange={onChange} min={props.min} max={props.max} ariaLabel={props.label} />
}

const usd = (v: number) => `US$${v.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`

function vestYear(grant: RsuGrant, nowYear: number): string {
  const at = grant.vestAt
  if (at.kind === 'year') return String(at.year)
  if (at.kind === 'now') return String(nowYear)
  if (at.kind === 'age') return `age ${at.age}`
  return `retirement${at.offset ? ` ${at.offset > 0 ? '+' : ''}${at.offset}` : ''}`
}

// Unvested shares as one or more vesting tranches.
function VestingSchedule({ holding, onChange, personId }: { holding: Holding; onChange: (grants: RsuGrant[]) => void; personId: string }) {
  const { nowYear } = usePlanStore()
  const [years, setYears] = useState(4)
  const total = holding.rsuGrants.reduce((s, g) => s + g.shares, 0)
  const spread = () => {
    const per = Math.floor(total / years)
    const grants = Array.from({ length: years }, (_, i) => ({
      id: newId('grant'),
      shares: i === years - 1 ? total - per * (years - 1) : per,
      vestAt: { kind: 'year' as const, year: nowYear + 1 + i },
    }))
    onChange(grants)
  }
  return (
    <div className="rounded border border-border p-2 space-y-2">
      <div className="text-[11px] text-fg-muted">
        Each tranche is taxed as employment income at the share price on its vesting date, then joins your vested shares with that value as its cost.
      </div>
      {holding.rsuGrants.map(g => (
        <div key={g.id} className="grid grid-cols-[6rem_1fr_auto] gap-2 items-center">
          {numberField(g.shares, v => onChange(holding.rsuGrants.map(x => (x.id === g.id ? { ...x, shares: Math.max(0, v) } : x))), { min: 0, label: 'Shares vesting' })}
          <TimePointPicker
            value={g.vestAt}
            onChange={(v) => v && onChange(holding.rsuGrants.map(x => (x.id === g.id ? { ...x, vestAt: v } : x)))}
            personId={personId}
            currentYear={nowYear}
            ariaLabel="Vesting date"
          />
          <button onClick={() => onChange(holding.rsuGrants.filter(x => x.id !== g.id))} className="p-1 text-fg-muted hover:text-danger" aria-label="Remove tranche">
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <button
          onClick={() => onChange([...holding.rsuGrants, { id: newId('grant'), shares: 0, vestAt: { kind: 'year', year: nowYear + 1 } }])}
          className="text-accent font-medium min-h-[28px]"
        >
          + Add tranche
        </button>
        {total > 0 && (
          <span className="flex items-center gap-1.5 text-fg-secondary">
            Spread {formatMoney(total)} shares evenly over
            <input type="number" min={1} max={10} value={years} onChange={(e) => setYears(Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 1)))} className="w-14 px-1.5 py-1 border border-border-strong rounded bg-surface" aria-label="Years to vest" />
            years
            <button onClick={spread} className="text-accent font-medium min-h-[28px]">Apply</button>
          </span>
        )}
      </div>
    </div>
  )
}

function HoldingRow({ account, holding }: { account: StockAccount; holding: Holding }) {
  const { activePlan, updateActivePlan, nowYear } = usePlanStore()
  const usdCad = activePlan.assumptions.usdCad.rate
  const quotes = useStockQuotes()
  const [open, setOpen] = useState(false)
  const [showVesting, setShowVesting] = useState(false)
  const update = (patch: Partial<Holding>) => updateActivePlan(p => patchHolding(p, account.id, holding.id, patch))
  const unvested = holding.rsuGrants.reduce((s, g) => s + g.shares, 0)
  const error = quotes.errors[holding.symbol.trim().toUpperCase()]
  const quote = holding.lastQuote

  // Typing an unvested count edits the schedule: one tranche next year, or
  // scale the existing tranches.
  const setUnvested = (shares: number) => {
    if (holding.rsuGrants.length === 0) {
      if (shares > 0) update({ rsuGrants: [{ id: newId('grant'), shares, vestAt: { kind: 'year', year: nowYear + 1 } }] })
      return
    }
    if (shares <= 0) return update({ rsuGrants: [] })
    const scale = unvested > 0 ? shares / unvested : 1
    const round4 = (v: number) => Math.round(v * 10000) / 10000
    const scaled = holding.rsuGrants.map(g => ({ ...g, shares: round4(g.shares * scale) }))
    const last = scaled[scaled.length - 1]
    last.shares = Math.max(0, round4(last.shares + shares - scaled.reduce((s, g) => s + g.shares, 0)))
    update({ rsuGrants: scaled })
  }

  return (
    <div className="rounded-lg border border-border p-2.5 space-y-2 bg-surface">
      <div className="grid grid-cols-2 sm:grid-cols-[7rem_1fr_1fr_1fr_auto] gap-2 items-end">
        <label>
          <span className={labelClass}>Symbol</span>
          <input
            value={holding.symbol}
            placeholder="e.g. SHOP.TO"
            onChange={(e) => update({ symbol: e.target.value.toUpperCase(), lastQuote: undefined })}
            className={inputClass}
            aria-label="Stock symbol"
          />
        </label>
        <label>
          <span className={labelClass}>Vested shares</span>
          {numberField(holding.shares, v => update({ shares: Math.max(0, v) }), { min: 0, label: 'Vested shares' })}
        </label>
        <label>
          <span className={labelClass}>
            Unvested shares
            <InfoTooltip text="RSUs or PSUs you have been granted but that have not vested yet. They are not counted in your net worth until they vest." />
          </span>
          {numberField(unvested, setUnvested, { min: 0, label: 'Unvested shares' })}
        </label>
        <label>
          <span className={labelClass}>Price (USD)</span>
          <NumberInput value={holding.priceUsd} onChange={(v) => update({ priceUsd: v, lastQuote: undefined })} min={0} decimals={4} prefix="US$" ariaLabel="Price per share in USD" />
        </label>
        <div className="flex items-center gap-1 pb-1">
          <button onClick={() => setOpen(!open)} className="flex items-center gap-0.5 text-xs text-accent min-h-[28px]" aria-expanded={open}>
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            Details
          </button>
          <button onClick={() => updateActivePlan(p => removeHolding(p, account.id, holding.id))} className="p-1 text-fg-muted hover:text-danger" aria-label="Remove stock">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-fg-muted">
        <span>Vested value ${formatMoney(holding.shares * holding.priceUsd * usdCad)} CAD</span>
        {unvested > 0 && (
          <button onClick={() => setShowVesting(!showVesting)} className="text-accent">
            Unvested ${formatMoney(unvested * holding.priceUsd * usdCad)} CAD at today's price · {holding.rsuGrants.length} tranche{holding.rsuGrants.length === 1 ? '' : 's'}
            {holding.rsuGrants.length > 0 && ` (${holding.rsuGrants.map(g => vestYear(g, nowYear)).join(', ')})`} — {showVesting ? 'hide' : 'edit'} schedule
          </button>
        )}
        {quote && !error && (
          <span title={`Fetched ${quote.fetchedAt.slice(0, 16).replace('T', ' ')}`}>
            {quote.currency === 'USD'
              ? usd(quote.price)
              : `${quote.currency} ${quote.price.toFixed(2)} = ${usd(holding.priceUsd)} (Bank of Canada rates)`}
            {' '}· {quote.source}, {quote.asOf.slice(0, 10)}{isStale(quote.fetchedAt) ? ' · refresh due' : ''}
          </span>
        )}
        {error && <span className="text-danger">{error}</span>}
      </div>

      {showVesting && unvested > 0 && (
        <VestingSchedule holding={holding} onChange={(rsuGrants) => update({ rsuGrants })} personId={account.ownerId} />
      )}

      {open && (
        <div className="space-y-2 pt-1">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <label>
              <span className={labelClass}>Average cost / share (CAD)</span>
              <NumberInput value={holding.costPerShare ?? Math.round(holding.priceUsd * usdCad * 100) / 100} onChange={(v) => update({ costPerShare: v })} min={0} decimals={4} ariaLabel="Average cost per share in CAD" />
            </label>
            <label>
              <span className={labelClass}>Dividend yield %</span>
              {numberField(holding.dividendYieldPct, v => update({ dividendYieldPct: Math.max(0, v) }), { min: 0, max: 20, label: 'Dividend yield' })}
            </label>
            <label>
              <span className={labelClass}>Dividends are</span>
              <select value={holding.dividendType} onChange={(e) => update({ dividendType: e.target.value as Holding['dividendType'] })} className={inputClass}>
                <option value="eligible">Canadian (eligible)</option>
                <option value="foreign">Foreign</option>
              </select>
            </label>
            <label>
              <span className={labelClass}>
                Volatility %
                <InfoTooltip text="Typical yearly swing (standard deviation) used by Monte Carlo. Large, stable companies are often 20–30%; small or fast-growing ones 40%+." />
              </span>
              {numberField(holding.volatilityPct, v => update({ volatilityPct: Math.max(0, v) }), { min: 0, max: 150, label: 'Volatility' })}
            </label>
          </div>
          <div>
            <span className={labelClass}>
              Price projection: yearly growth % (excluding dividends)
              <InfoTooltip text="Your view of how the share price might grow each year in a bad, expected and good case. The case used in projections is chosen for the whole account." />
            </span>
            <div className="grid grid-cols-3 gap-2">
              {STOCK_SCENARIOS.map(sc => (
                <label key={sc} className="flex items-center gap-1.5 text-xs text-fg-secondary">
                  <span className="w-9">{SCENARIO_LABELS[sc]}</span>
                  {numberField(holding.growthPct[sc], v => update({ growthPct: { ...holding.growthPct, [sc]: v } }), { min: -50, max: sc === 'bull' ? 100 : 50, label: `${SCENARIO_LABELS[sc]} growth` })}
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-fg-secondary">
            <input
              type="checkbox"
              checked={holding.espp !== undefined}
              onChange={(e) => update({ espp: e.target.checked ? { annualContribution: 5000, discountPct: 15, employerMatchPct: 0, indexed: true } : undefined })}
             
            />
            I buy this stock through an employee purchase plan (ESPP)
          </label>
          {holding.espp && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <label>
                <span className={labelClass}>My contribution / yr</span>
                <NumberInput value={holding.espp.annualContribution} onChange={(v) => update({ espp: { ...holding.espp!, annualContribution: v } })} min={0} ariaLabel="ESPP contribution" />
              </label>
              <label>
                <span className={labelClass}>Discount %</span>
                {numberField(holding.espp.discountPct, v => update({ espp: { ...holding.espp!, discountPct: Math.min(50, Math.max(0, v)) } }), { min: 0, max: 50, label: 'ESPP discount' })}
              </label>
              <label>
                <span className={labelClass}>Employer match %</span>
                {numberField(holding.espp.employerMatchPct, v => update({ espp: { ...holding.espp!, employerMatchPct: Math.max(0, v) } }), { min: 0, max: 200, label: 'Employer match' })}
              </label>
              <div>
                <span className={labelClass}>Until</span>
                <TimePointPicker value={holding.espp.to} onChange={(v) => update({ espp: { ...holding.espp!, to: v } })} personId={account.ownerId} unsetLabel="Retirement" currentYear={nowYear} ariaLabel="ESPP end" />
              </div>
              <p className="col-span-2 sm:col-span-4 text-[11px] text-fg-muted">
                The discount and employer match are taxable employment income; the shares' cost is their market value at purchase.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MarketDataSettingsPanel() {
  const quotes = useStockQuotes()
  const { settings } = quotes
  const provider = QUOTE_PROVIDERS[settings.provider]
  return (
    <div className="rounded border border-border p-2.5 space-y-2 text-xs">
      <div className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-2">
        <label>
          <span className={labelClass}>Price source</span>
          <select value={settings.provider} onChange={(e) => quotes.setSettings({ provider: e.target.value as QuoteProvider })} className={inputClass}>
            {(Object.keys(QUOTE_PROVIDERS) as QuoteProvider[]).map(k => <option key={k} value={k}>{QUOTE_PROVIDERS[k].name}</option>)}
          </select>
        </label>
        <label>
          <span className={labelClass}>
            API key (<a href={provider.keyUrl} target="_blank" rel="noreferrer" className="text-accent underline">get a free key</a>)
          </span>
          <input
            type="password"
            autoComplete="off"
            value={settings.apiKey}
            onChange={(e) => quotes.setSettings({ apiKey: e.target.value.trim() })}
            className={inputClass}
            aria-label="Market data API key"
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-fg-secondary">
        <input type="checkbox" checked={settings.autoRefresh} onChange={(e) => quotes.setSettings({ autoRefresh: e.target.checked })} />
        Update prices automatically once a day when I open the plan
      </label>
      <p className="text-[11px] text-fg-muted">
        {provider.note} Share prices are kept in US dollars; Canadian listings are converted with Bank of Canada daily rates. The key is stored only in this browser and is
        never included in exports or share links; your symbols are sent to {provider.name} to look up prices.
      </p>
    </div>
  )
}

export function StockAccountEditor({ account }: { account: StockAccount }) {
  const { activePlan, updateActivePlan, nowYear } = usePlanStore()
  const quotes = useStockQuotes()
  const [showSettings, setShowSettings] = useState(!quotes.settings.apiKey)
  const sale = account.salePlan
  const scenario = activePlan.assumptions.stockScenario
  const fx = activePlan.assumptions.usdCad
  const vestedValue = account.holdings.reduce((s, h) => s + h.shares * h.priceUsd, 0) * fx.rate
  const unvestedValue = account.holdings.reduce((s, h) => s + h.rsuGrants.reduce((t, g) => t + g.shares, 0) * h.priceUsd, 0) * fx.rate
  const hasSymbols = account.holdings.some(h => h.symbol.trim())
  const anchor = account.ownerId === 'joint' ? activePlan.people[0].id : account.ownerId

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-fg-secondary">
          Vested <strong className="text-fg">${formatMoney(vestedValue)}</strong> CAD
          {unvestedValue > 0 && <> · unvested ${formatMoney(unvestedValue)}</>}
        </span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => void quotes.refresh()}
            disabled={!quotes.settings.apiKey || !hasSymbols || quotes.refreshing}
            className="flex items-center gap-1 text-accent font-medium min-h-[28px] disabled:text-fg-muted"
            title={!quotes.settings.apiKey ? 'Add an API key under Price data' : 'Fetch current prices'}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${quotes.refreshing ? 'animate-spin' : ''}`} />
            {quotes.refreshing ? 'Updating…' : 'Refresh prices'}
          </button>
          <button onClick={() => setShowSettings(!showSettings)} className="text-accent min-h-[28px]" aria-expanded={showSettings}>
            Price data
          </button>
        </div>
      </div>
      {showSettings && <MarketDataSettingsPanel />}

      <div className="flex flex-wrap items-end gap-x-3 gap-y-1 text-xs">
        <label>
          <span className={labelClass}>
            US$1 in Canadian dollars
            <InfoTooltip text="Share prices are entered in US dollars and converted to Canadian dollars at this rate. Projections keep the rate constant." />
          </span>
          <DecimalInput value={fx.rate} min={0.01} max={10} onChange={(v) => updateActivePlan(p => setUsdCad(p, v))} className="w-28" ariaLabel="USD to CAD exchange rate" />
        </label>
        <span className="pb-2.5 text-[11px] text-fg-muted">
          {fx.asOf ? `Bank of Canada, ${fx.asOf}` : fx.rate === DEFAULT_USD_CAD ? 'Default rate' : 'Entered by you'}
        </span>
        <button onClick={() => void quotes.refreshRate()} disabled={quotes.refreshing} className="pb-2 text-accent font-medium min-h-[28px] disabled:text-fg-muted">
          Use today's rate
        </button>
        {quotes.rateError && <span className="pb-2.5 text-[11px] text-danger">{quotes.rateError}</span>}
      </div>

      {account.holdings.map(h => <HoldingRow key={h.id} account={account} holding={h} />)}
      <button onClick={() => updateActivePlan(p => addHolding(p, account.id))} className="text-xs text-accent font-medium min-h-[28px]">
        + Add stock
      </button>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border-t border-border pt-2">
        <label>
          <span className={labelClass}>
            Price case for projections
            <InfoTooltip text="Which of each stock's bear, base or bull growth rates the projections use. The Projections tab compares all three." />
          </span>
          <SegmentedControl
            ariaLabel="Price case"
            size="sm"
            value={scenario}
            onChange={(sc) => updateActivePlan(p => setStockScenario(p, sc))}
            options={STOCK_SCENARIOS.map(sc => ({ value: sc, label: SCENARIO_LABELS[sc] }))}
          />
        </label>
        <label>
          <span className={labelClass}>
            Sell plan
            <InfoTooltip text="Fixed amount: sell this much stock every year (today's dollars) to fund retirement; anything not needed is reinvested after tax. Cover the gap: sell stock first, only as much as spending needs, before touching other accounts. Gains are taxed when you sell." />
          </span>
          <select
            value={sale.kind}
            onChange={(e) => updateActivePlan(p => setStockSalePlan(p, account.id,
              e.target.value === 'fixedAmount' ? { kind: 'fixedAmount', amount: 30000 }
                : e.target.value === 'coverGap' ? { kind: 'coverGap' }
                  : { kind: 'none' }))}
            className={inputClass}
          >
            <option value="none">Don't plan sales (sell only if needed)</option>
            <option value="fixedAmount">Sell a fixed amount every year</option>
            <option value="coverGap">Sell first to cover my spending gap</option>
          </select>
        </label>
        {sale.kind !== 'none' && (
          <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
            {sale.kind === 'fixedAmount' && (
              <label>
                <span className={labelClass}>Amount / yr (today's $)</span>
                <NumberInput value={sale.amount} onChange={(v) => updateActivePlan(p => setStockSalePlan(p, account.id, { ...sale, amount: v }))} min={0} ariaLabel="Yearly sale amount" />
              </label>
            )}
            <div>
              <span className={labelClass}>From</span>
              <TimePointPicker value={sale.from} onChange={(v) => updateActivePlan(p => setStockSalePlan(p, account.id, { ...sale, from: v }))} personId={anchor} unsetLabel="Household retirement" currentYear={nowYear} ariaLabel="Sell from" />
            </div>
            <div>
              <span className={labelClass}>Until</span>
              <TimePointPicker value={sale.to} onChange={(v) => updateActivePlan(p => setStockSalePlan(p, account.id, { ...sale, to: v }))} personId={anchor} unsetLabel="Shares run out" currentYear={nowYear} ariaLabel="Sell until" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
