import type { ComponentType } from 'react'
import {
  ArrowDownToLine, BookOpen, Columns3, Dice5, FilePen, Home, Landmark, LayoutDashboard, Lightbulb, LineChart,
  PiggyBank, Receipt, ShoppingBasket, SlidersHorizontal, TrendingUp, Users, Waves, Wallet,
} from 'lucide-react'
import type { PlanSection, ViewId } from '@/lib/ui/route'

type Icon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>

export interface NavItem {
  view: ViewId
  label: string
  icon: Icon
}

export interface NavGroup {
  label?: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  { items: [{ view: 'plan', label: 'Plan', icon: FilePen }] },
  {
    label: 'Results',
    items: [
      { view: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { view: 'projections', label: 'Projections', icon: TrendingUp },
      { view: 'cashflow', label: 'Cash flow', icon: Waves },
      { view: 'taxes', label: 'Taxes', icon: Receipt },
      { view: 'risk', label: 'Risk', icon: Dice5 },
      { view: 'proposals', label: 'Proposals', icon: Lightbulb },
    ],
  },
  {
    label: 'Tools',
    items: [
      { view: 'compare', label: 'Compare', icon: Columns3 },
      { view: 'tracking', label: 'Tracking', icon: LineChart },
    ],
  },
  { items: [{ view: 'learn', label: 'Learn', icon: BookOpen }] },
]

export interface PlanSectionMeta {
  id: PlanSection
  label: string
  description: string
  icon: Icon
}

export const PLAN_SECTION_META: PlanSectionMeta[] = [
  { id: 'household', label: 'Household', icon: Users, description: 'Who the plan is for, when you retire, and your government benefits.' },
  { id: 'savings', label: 'Savings', icon: PiggyBank, description: 'Your accounts today and what you add to them each year.' },
  { id: 'income', label: 'Income', icon: Wallet, description: 'Salary, pensions and other income, now and in retirement.' },
  { id: 'spending', label: 'Spending', icon: ShoppingBasket, description: 'What you expect to spend once you retire.' },
  { id: 'property', label: 'Home & debts', icon: Home, description: 'Real estate you own and money you owe.' },
  { id: 'withdrawals', label: 'Withdrawals', icon: ArrowDownToLine, description: 'How savings are drawn down in retirement, and RRIF rules.' },
  { id: 'assumptions', label: 'Assumptions', icon: SlidersHorizontal, description: 'Investment returns and inflation used for every projection.' },
]

export const VIEW_LABELS: Record<ViewId, string> = {
  plan: 'Plan',
  dashboard: 'Dashboard',
  projections: 'Projections',
  cashflow: 'Cash flow',
  taxes: 'Taxes',
  risk: 'Risk',
  proposals: 'Proposals',
  compare: 'Compare',
  tracking: 'Tracking',
  learn: 'Learn',
}

export const BRAND_ICON: Icon = Landmark
