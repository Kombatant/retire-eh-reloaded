import { useSubView } from '@/hooks/useSubView'
import { cn } from '@/lib/ui/cn'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Callout } from '@/components/ui/Callout'
import { Select } from '@/components/ui/inputs'
import { ArrowRight, TrendingUp, Coins, Landmark, Flag, Settings, AlertTriangle, Briefcase, Percent, Dice5, ArrowDownToLine, ScrollText, Wallet, type LucideIcon } from 'lucide-react'

interface LearnSection {
  id: string
  title: string
  icon: LucideIcon
  content: React.ReactNode
}

const sections: LearnSection[] = [
  {
    id: 'projections',
    title: 'How Projections Work',
    icon: TrendingUp,
    content: (
      <div className="space-y-3 text-sm text-fg-secondary">
        <p>
          Projections use <strong className="text-fg">compound growth</strong> to estimate your portfolio's future value. Each year, your portfolio grows by the expected return rate, and you add contributions.
        </p>
        <p>
          The formula: <code className="rounded bg-surface-muted px-1.5 py-0.5 text-[13px] text-fg">Future Value = Present × (1 + rate)^years + contributions</code>
        </p>
        <p>
          We also account for <strong className="text-fg">inflation</strong>. "Today's dollars" shows what your money can buy in today's terms, making it easier to understand.
        </p>
      </div>
    )
  },
  {
    id: 'real-returns',
    title: 'Nominal vs Real Returns',
    icon: Percent,
    content: (
      <div className="space-y-3 text-sm text-fg-secondary">
        <p>
          The return you enter under Plan › Assumptions — <strong className="text-fg">7% by default</strong> — is a <strong className="text-fg">nominal</strong> return. That's the raw growth number, <em>before</em> inflation is taken into account.
        </p>
        <p>
          A <strong className="text-fg">real</strong> return is what your money actually buys after inflation. Convert between them with:{' '}
          <code className="rounded bg-surface-muted px-1.5 py-0.5 text-[13px] text-fg">real ≈ (1 + nominal) ÷ (1 + inflation) − 1</code>
        </p>
        <p>
          <strong className="text-fg">Example:</strong> $100 earning 7% nominal becomes $107. But with 2.5% inflation it only buys about $104.40 of last year's goods — so the <em>real</em> gain is ~4.4%.
        </p>
        <p>
          This calculator keeps the two separate: the projection compounds at the <em>nominal</em> rate, and the <strong className="text-fg">Today's $ / Future $</strong> switch in the top bar deflates the result into <em>today's dollars</em> so you see true purchasing power.
        </p>
        <p className="text-xs text-warning flex items-center gap-1">
          <AlertTriangle className="inline w-4 h-4 text-warning" />
          Always compare like with like: a 7% nominal return and a ~4.4% real return describe the same outcome — just measured differently.
        </p>
      </div>
    )
  },
  {
    id: 'withdrawal-rate',
    title: 'Safe Withdrawal Rate (4% Rule)',
    icon: Coins,
    content: (
      <div className="space-y-3 text-sm text-fg-secondary">
        <p>
          The <strong className="text-fg">4% rule</strong> is a guideline for sustainable retirement withdrawals. It suggests you can withdraw 4% of your portfolio in the first year, then adjust for inflation each year.
        </p>
        <p>
          Historically, this approach has sustained portfolios for 30+ years across various market conditions.
        </p>
        <p>
          <strong className="text-fg">Example:</strong> A $1,000,000 portfolio would provide $40,000/year in the first year.
        </p>
        <p className="text-xs text-warning flex items-center gap-1">
          <AlertTriangle className="inline w-4 h-4 text-warning" />
          This is a guideline, not a guarantee. Actual needs may vary based on market performance and spending.
        </p>
        <p>
          If you plan one-time gifts (e.g., helping kids with a down payment), enter them under <strong className="text-fg">Planned Gifts</strong> in the Plan tab. They're reserved from your retirement portfolio, so your sustainable withdrawal is based on what remains after setting that money aside.
        </p>
      </div>
    )
  },
  {
    id: 'rrsp-tfsa',
    title: 'RRSP vs TFSA',
    icon: Landmark,
    content: (
      <div className="space-y-3 text-sm text-fg-secondary">
        <p>
          Both accounts offer tax advantages, but in different ways:
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="p-3 bg-surface-muted rounded-lg">
            <strong className="text-fg">RRSP</strong>
            <ul className="mt-2 space-y-1 text-xs">
              <li>• Tax deduction on contributions</li>
              <li>• Tax-deferred growth</li>
              <li>• Taxed on withdrawal</li>
              <li>• Best in high-income years</li>
            </ul>
          </div>
          <div className="p-3 bg-surface-muted rounded-lg">
            <strong className="text-success">TFSA</strong>
            <ul className="mt-2 space-y-1 text-xs">
              <li>• No tax deduction</li>
              <li>• Tax-free growth</li>
              <li>• Tax-free withdrawal</li>
              <li>• Best in lower-income years</li>
            </ul>
          </div>
        </div>
        <p>
          <strong className="text-fg">Strategy:</strong> Prioritize RRSP when your marginal tax rate is high, TFSA when it's lower.
        </p>
        <p className="mt-2 pt-2 border-t border-border text-xs">
          <strong className="text-fg block mb-1">Pre-Tax vs. After-Tax Projections:</strong>
          Because RRSP withdrawals are taxed as regular income, a dollar in an RRSP does not have the same purchasing power as a dollar in a TFSA. This app estimates 2026 federal and provincial income tax for each person's province or territory, including the basic, age and pension credits, the OAS clawback, GIS, and pension income splitting between spouses. That estimated tax is used to compute your <strong>After-Tax Net Worth</strong> and target progress, so you can see how much additional savings you need to cover both your base goals and your expected tax liabilities.
        </p>
      </div>
    )
  },
  {
    id: 'cpp-oas',
    title: 'CPP & OAS',
    icon: Flag,
    content: (
      <div className="space-y-3 text-sm text-fg-secondary">
        <p>
          Canadian government benefits provide a foundation for retirement income:
        </p>
        <div className="space-y-3">
          <div className="p-3 bg-surface-muted rounded-lg">
            <strong className="text-fg">CPP (Canada Pension Plan)</strong>
            <p className="mt-1 text-xs space-y-2">
              <span className="block">
                A <strong>contribution-based</strong> benefit (not need-based). What you receive depends on how much you contributed over your career, not on your current savings.
              </span>
              <span className="block">
                Your pension is calculated from your <strong>best 83% of working years</strong> (the 17% lowest/zero-earning years are dropped). Each year only counts up to the <strong>Year's Maximum Pensionable Earnings (YMPE)</strong> — earning above it doesn't increase CPP.
              </span>
              <span className="block">
                <strong>Maximum ~$1,508/month at age 65</strong> (2026). To reach the maximum you generally need ~39 years of maximum contributions.
              </span>
              <span className="block">
                You can take it from age <strong>60 to 70</strong>. Each month before 65 reduces the amount by ~0.6% (about 7.2%/year); each month after 65 increases it by ~0.7% until 70. Set your <strong>CPP Start Age</strong> on the Plan tab and the app adjusts your age-65 estimate automatically.
              </span>
              <span className="block">
                Your <strong>official estimate</strong> lives in your My Service Canada Account under "CPP Statement of Contributions."
              </span>
            </p>
          </div>
          <div className="p-3 bg-surface-muted rounded-lg">
            <strong className="text-fg">OAS (Old Age Security)</strong>
            <p className="mt-1 text-xs">
              Available at 65, based on residency (40 years in Canada for the full amount). Maximum ~$752/month in 2026.
              You can defer OAS to as late as 70 for a permanent increase of 0.6% per month (7.2%/year). Set your{' '}
              <strong>OAS Start Age</strong> on the Plan tab. Clawed back at high income (starting ~$95k).
            </p>
          </div>
        </div>
        <p className="text-xs text-fg-muted">
          * Amounts are estimates and subject to change. Visit canada.ca for current rates.
        </p>
      </div>
    )
  },
  {
    id: 'pensions',
    title: 'Workplace Pensions',
    icon: Briefcase,
    content: (
      <div className="space-y-3 text-sm text-fg-secondary">
        <p>
          Many Canadian employers — especially governments and large organizations — offer a <strong className="text-fg">Defined Benefit (DB) pension</strong>. Unlike your savings, a DB pension pays a guaranteed, inflation-indexed income for life, calculated from your salary and years of service.
        </p>
        <p>
          The core formula is:{' '}
          <code className="rounded bg-surface-muted px-1.5 py-0.5 text-[13px] text-fg">
            Annual pension = accrual rate × best-average salary × years of service
          </code>
        </p>
        <p>
          <strong className="text-fg">Example — federal public servant:</strong> Someone who starts at ~23, retires at 58 with ~35 years of service, and peaks around $100k salary:
        </p>
        <ul className="space-y-1 text-xs">
          <li>• Accrual rate: 2% (post-2013 federal rate)</li>
          <li>• Best-5 average salary: ~$100,000</li>
          <li>• Years of service: ~35</li>
          <li>
            • <strong className="text-fg">≈ 2% × $100,000 × 35 = $70,000/year</strong>
          </li>
        </ul>
        <div className="p-3 bg-surface-muted rounded-lg">
          <strong className="text-fg">In this app</strong>
          <p className="mt-1 text-xs">
            Enter this as <strong>Annual Employer Pension (at retirement)</strong> on the Plan tab. It's added to CPP and OAS as guaranteed income starting at your retirement age. Leave at 0 if you have no workplace pension — for example, a DC plan or RRSP is already captured in your investment accounts.
          </p>
        </div>
        <p className="text-xs text-fg-muted">
          * Federal employees also receive a temporary "bridge benefit" from retirement to 65 roughly equal to CPP. Since this app counts CPP separately, don't add the bridge amount.
        </p>
      </div>
    )
  },
  {
    id: 'withdrawals',
    title: 'Withdrawal Strategies, RRIFs and Meltdowns',
    icon: ArrowDownToLine,
    content: (
      <div className="space-y-3 text-sm text-fg-secondary">
        <p>
          <strong className="text-fg">Fixed rate</strong> withdraws a % of the portfolio in the first retirement year and then the same inflation-adjusted amount.
          <strong className="text-fg"> Fund my spending</strong> withdraws exactly what your budget needs after other income and tax.
          <strong className="text-fg"> % of portfolio</strong>, <strong className="text-fg">guardrails (Guyton-Klinger)</strong> and <strong className="text-fg">VPW</strong> let spending rise and fall with markets; in a detailed budget they never cut below essential items.
        </p>
        <p>
          You can convert an RRSP to a RRIF at any age, in whole or in part, but it must become a RRIF (or buy an annuity) by the end of the year you turn 71. From 65, RRIF payments qualify for the pension income credit and pension splitting, while plain RRSP withdrawals do not. A RRIF has a <strong className="text-fg">minimum withdrawal</strong> every year (about 5.3% at 72, rising to 20% at 95). Minimums you do not need are reinvested after tax. LIRAs unlock as LIFs (from 55) with both a minimum and a maximum.
        </p>
        <p>
          An <strong className="text-fg">RRSP meltdown</strong> withdraws extra RRSP money in low-income years to fill a target tax bracket, then reinvests it (TFSA first). It can lower lifetime tax, reduce the OAS clawback later, and shrink the RRIF that is fully taxed at death.
        </p>
      </div>
    )
  },
  {
    id: 'risk',
    title: 'Risk: Monte Carlo and Historical Backtests',
    icon: Dice5,
    content: (
      <div className="space-y-3 text-sm text-fg-secondary">
        <p>
          The <strong className="text-fg">Monte Carlo</strong> simulation re-runs your whole plan (taxes, benefits, withdrawals) hundreds of times with random yearly returns for Canadian equities, bonds and cash, and optionally random inflation that persists from year to year. The chance of success is the share of runs where every year is funded.
        </p>
        <p>
          The returns you enter are <strong className="text-fg">long-run compounded rates</strong>, the same convention as FP Canada's projection guidelines. A loss takes a bigger gain to recover, so an investment that swings needs a higher average yearly return to compound at a given rate. Monte Carlo makes that adjustment using each investment's volatility: a typical run compounds at the rate you entered, and higher volatility widens the range of outcomes around it.
        </p>
        <p>
          The <strong className="text-fg">historical backtest</strong> replays actual Canadian returns and inflation (1957–2015, derived from Statistics Canada tables) starting in each year. Plans longer than the data wrap around. Stress tests replay the 2008 crisis, the 2000–2002 tech crash and 1970s stagflation at the start of retirement.
        </p>
        <p>
          A high success rate is reassuring but not a guarantee; most plans can be adjusted along the way. Many planners aim for 80–90% and revisit the plan every year.
        </p>
      </div>
    )
  },
  {
    id: 'estate',
    title: 'Survivors and Your Estate',
    icon: ScrollText,
    content: (
      <div className="space-y-3 text-sm text-fg-secondary">
        <p>
          When a spouse dies, registered accounts and TFSAs can roll over to the survivor tax-free. The survivor keeps their own benefits, a share of a DB pension (the survivor %), and a CPP survivor's pension (60% of the deceased's pension at 65+, within the CPP maximum). From then on the survivor files a single return, without pension splitting.
        </p>
        <p>
          At the last death, RRSPs and RRIFs are added to income on the final return and other investments are treated as sold, so capital gains are taxed (a principal residence is exempt). The estimate puts everything on one return, even when a couple's life expectancies end in the same year, because a spousal rollover leaves it all with the survivor. Provincial probate fees may also apply. The estate card shows what is left for heirs.
        </p>
      </div>
    )
  },
  {
    id: 'assumptions',
    title: 'Assumptions & Defaults',
    icon: Settings,
    content: (
      <div className="space-y-3 text-sm text-fg-secondary">
        <p>
          This calculator uses conservative assumptions by default:
        </p>
        <ul className="space-y-2">
          <li className="flex items-start gap-2">
            <span className="text-fg-muted">•</span>
            <span><strong className="text-fg">7% expected return (nominal):</strong> Raw annual return before inflation. After 2.5% inflation, the real return is about 4.4%.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-fg-muted">•</span>
            <span><strong className="text-fg">2.5% inflation:</strong> Bank of Canada target is 2%, but we use slightly higher for safety.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-fg-muted">•</span>
            <span><strong className="text-fg">70% replacement rate:</strong> Common guideline for retirement income needs.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-fg-muted">•</span>
            <span><strong className="text-fg">4% withdrawal rate:</strong> Safe withdrawal rate for 30-year retirement.</span>
          </li>
        </ul>
        <p className="text-xs text-warning flex items-center gap-1">
          <AlertTriangle className="inline w-4 h-4 text-warning" />
          These are assumptions. Actual returns and inflation will vary. Consider consulting a financial advisor for personalized advice.
        </p>
      </div>
    )
  },
  {
    id: 'income-sources',
    title: 'Where Retirement Income Comes From',
    icon: Wallet,
    content: (
      <div className="space-y-3 text-sm text-fg-secondary">
        <p>
          <strong className="text-fg">From savings:</strong> a sustainable withdrawal from your accounts. The Dashboard uses your
          withdrawal rate (4% by default), a common rule of thumb for income that lasts. A property you plan to sell in retirement counts
          too: what the sale leaves after costs, the mortgage and any next home, reduced for the years you wait for it.
        </p>
        <p>
          <strong className="text-fg">CPP / QPP:</strong> the Canada (or Quebec) Pension Plan, based on your working years and earnings.
          The maximum at 65 in 2026 is about $1,508 a month.
        </p>
        <p>
          <strong className="text-fg">OAS:</strong> Old Age Security, available from 65; each month you defer (up to 70) adds 0.6%.
          The maximum in 2026 is about $752 a month, and it is clawed back at higher incomes (from about $95,000).
        </p>
        <p>
          <strong className="text-fg">Workplace pension:</strong> any defined benefit pension you entered under Plan › Income.
        </p>
      </div>
    ),
  },
]

const ORDER = ['projections', 'real-returns', 'income-sources', 'withdrawal-rate', 'rrsp-tfsa', 'cpp-oas', 'pensions', 'withdrawals', 'risk', 'estate', 'assumptions']
const ordered = ORDER.map(id => sections.find(s => s.id === id)!).filter(Boolean)
const TOPIC_IDS = ordered.map(s => s.id)

export function LearnView() {
  const [topic, setTopic] = useSubView(TOPIC_IDS, TOPIC_IDS[0])
  const section = ordered.find(s => s.id === topic) ?? ordered[0]
  const index = ordered.indexOf(section)
  const next = ordered[index + 1]
  const Icon = section.icon

  return (
    <>
      <PageHeader title="Learn" description="The ideas behind your projection, in plain language." />
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <nav aria-label="Topics" className="lg:sticky lg:top-[5.5rem] lg:w-60 lg:shrink-0">
          <div className="lg:hidden">
            <Select aria-label="Topic" value={topic} onChange={(e) => setTopic(e.target.value)}>
              {ordered.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
            </Select>
          </div>
          <ul className="hidden space-y-0.5 lg:block">
            {ordered.map(s => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setTopic(s.id)}
                  aria-current={s.id === topic ? 'page' : undefined}
                  className={cn(
                    'w-full rounded-md px-2.5 py-2 text-left text-[13px] transition-colors',
                    s.id === topic ? 'bg-surface-muted font-medium text-fg' : 'text-fg-secondary hover:text-fg',
                  )}
                >
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 flex-1 space-y-5">
          <Card padding="lg" as="article">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-fg">
              <Icon className="h-5 w-5 text-fg-muted" aria-hidden />
              {section.title}
            </h2>
            <div className="max-w-2xl leading-relaxed">{section.content}</div>
            {next && (
              <button
                type="button"
                onClick={() => setTopic(next.id)}
                className="mt-6 inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:text-accent-hover"
              >
                Next: {next.title} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </Card>
          <Callout tone="warning" title="Not financial advice">
            This planner gives estimates for education only. Results will differ with markets, tax changes and your circumstances.
            Consider a qualified financial planner for advice specific to you.
          </Callout>
        </div>
      </div>
    </>
  )
}
