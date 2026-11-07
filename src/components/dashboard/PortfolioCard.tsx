import { formatMoney, formatCompactMoney } from '@/lib/formatting'
import { ACCOUNT_GROUP_LABELS, type AccountGroup } from '@/lib/plan/accountGroups'
import { Wallet } from 'lucide-react'

interface PortfolioCardProps {
  totalPortfolio: number
  groups: Record<AccountGroup, number>
}

const DONUT_R = 52
const DONUT_C = 2 * Math.PI * DONUT_R

const GROUP_COLORS: Record<AccountGroup, string> = {
  registered: '#6366f1',
  tfsa: '#10b981',
  taxable: '#0ea5e9',
}

export function PortfolioCard({ totalPortfolio, groups }: PortfolioCardProps) {
  const entries = (Object.keys(groups) as AccountGroup[])
    .map(key => ({ key, value: groups[key] }))
    .filter(e => e.value > 0)
  const total = totalPortfolio > 0 ? totalPortfolio : entries.reduce((s, e) => s + e.value, 0)

  let offset = 0
  const segments = entries.map(e => {
    const frac = total > 0 ? e.value / total : 0
    const segment = { ...e, frac, offset }
    offset += frac
    return segment
  })

  return (
    <div className="animate-fade-in-up card p-6">
      <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4 flex items-center gap-2">
        <Wallet className="w-5 h-5 text-primary" />
        Current Portfolio
      </h2>
      <div className="flex items-center justify-start">
        <div className="relative w-full max-w-[340px] h-32">
          <svg viewBox="0 0 260 120" className="w-full h-full">
            <circle cx="60" cy="60" r={DONUT_R} fill="none" stroke="currentColor" className="text-gray-200 dark:text-gray-700 donut-segment" strokeWidth="14" transform="rotate(-90 60 60)" />
            {segments.map(s => (
              <circle
                key={s.key}
                cx="60"
                cy="60"
                r={DONUT_R}
                fill="none"
                stroke={GROUP_COLORS[s.key]}
                strokeWidth="14"
                strokeDasharray={`${s.frac * DONUT_C} ${DONUT_C}`}
                strokeDashoffset={-s.offset * DONUT_C}
                className="donut-segment"
                transform="rotate(-90 60 60)"
              >
                <title>{ACCOUNT_GROUP_LABELS[s.key]}: ${formatMoney(s.value)} ({Math.round(s.frac * 100)}%)</title>
              </circle>
            ))}

            <text x="60" y="58" textAnchor="middle" className="fill-gray-400 dark:fill-gray-500 text-[10px] uppercase font-semibold tracking-wider">Total</text>
            <text x="60" y="76" textAnchor="middle" className="fill-gray-800 dark:fill-gray-100 text-[15px] font-bold">${formatCompactMoney(total)}</text>

            {segments.map((s, i) => {
              const y = 30 + i * 36
              return (
                <g key={s.key}>
                  <circle cx="136" cy={y - 4} r="5" fill={GROUP_COLORS[s.key]} />
                  <text x="148" y={y} className="fill-gray-800 dark:fill-gray-100 text-[12px] font-semibold">
                    {ACCOUNT_GROUP_LABELS[s.key]} ({Math.round(s.frac * 100)}%)
                  </text>
                  <text x="148" y={y + 15} className="fill-gray-500 dark:fill-gray-400 text-[11px] font-medium">${formatMoney(s.value)}</text>
                </g>
              )
            })}
          </svg>
        </div>
      </div>
    </div>
  )
}
