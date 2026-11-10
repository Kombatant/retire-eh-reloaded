import { ExternalLink, GitCommitHorizontal, Monitor, Moon, Palette, SlidersHorizontal, Sun } from 'lucide-react'
import { useRoute } from '@/contexts/RouteContext'
import { useTheme, type ThemeMode } from '@/contexts/ThemeContext'
import { useDetailLevel } from '@/hooks/useDetailLevel'
import { cn } from '@/lib/ui/cn'
import type { Route } from '@/lib/ui/route'
import { formatRoute } from '@/lib/ui/route'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Switch } from '@/components/ui/Checkbox'
import { NAV_GROUPS, PLAN_SECTION_META } from './navItems'

declare const __APP_VERSION__: string

// Navigation for the whole app. On wide screens it is a fixed column; on
// small screens the same content is shown in a drawer (see AppShell).
export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { route, navigate } = useRoute()

  const go = (next: Route) => (event: React.MouseEvent) => {
    // Keep normal link behaviour for new-tab clicks.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
    event.preventDefault()
    navigate(next)
    onNavigate?.()
  }

  return (
    <div className="flex h-full flex-col">
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi} className={gi > 0 ? 'mt-5' : undefined}>
            {group.label && (
              <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted" aria-hidden>
                {group.label}
              </div>
            )}
            <ul className="space-y-0.5">
              {group.items.map(item => {
                const active = route.view === item.view
                const Icon = item.icon
                const target: Route = item.view === 'plan' ? { view: 'plan', sub: 'household' } : { view: item.view }
                return (
                  <li key={item.view}>
                    <a
                      href={formatRoute(target)}
                      onClick={go(target)}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex min-h-[36px] items-center gap-2.5 rounded-md px-2 text-sm font-medium transition-colors',
                        active ? 'bg-surface-muted text-fg' : 'text-fg-secondary hover:bg-surface-muted hover:text-fg',
                      )}
                    >
                      <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-accent' : 'text-fg-muted')} aria-hidden />
                      {item.label}
                    </a>
                    {item.view === 'plan' && active && (
                      <ul className="mb-1 ml-[17px] mt-0.5 space-y-0.5 border-l border-border pl-2.5">
                        {PLAN_SECTION_META.map(section => {
                          const current = route.sub === section.id
                          const sectionRoute: Route = { view: 'plan', sub: section.id }
                          return (
                            <li key={section.id}>
                              <a
                                href={formatRoute(sectionRoute)}
                                onClick={go(sectionRoute)}
                                aria-current={current ? 'step' : undefined}
                                className={cn(
                                  'flex min-h-[32px] items-center rounded-md px-2 text-[13px] transition-colors',
                                  current ? 'font-medium text-accent' : 'text-fg-secondary hover:text-fg',
                                )}
                              >
                                {section.label}
                              </a>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
      <SidebarFooter />
    </div>
  )
}

const THEME_OPTIONS: { value: ThemeMode; label: React.ReactNode; title: string }[] = [
  { value: 'light', label: <Sun className="h-3.5 w-3.5" aria-label="Light" />, title: 'Light theme' },
  { value: 'dark', label: <Moon className="h-3.5 w-3.5" aria-label="Dark" />, title: 'Dark theme' },
  { value: 'system', label: <Monitor className="h-3.5 w-3.5" aria-label="System" />, title: 'Match system theme' },
]

// Docker builds pass the full commit hash; seven characters identify it.
const displayVersion = (v: string) => (/^[0-9a-f]{8,}$/i.test(v) ? v.slice(0, 7) : v)

function SidebarFooter() {
  const { mode, setMode } = useTheme()
  const { isAdvanced, setDetailLevel } = useDetailLevel()

  return (
    <div className="border-t border-border p-3">
      <div className="divide-y divide-border rounded-lg border border-border bg-surface-muted/50">
        <div className="flex items-start gap-2.5 px-3 py-2.5">
          <SlidersHorizontal className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
          <Switch
            className="min-w-0 flex-1"
            checked={isAdvanced}
            onChange={(on) => setDetailLevel(on ? 'advanced' : 'essentials')}
            label="Advanced mode"
            description="Every input and analysis"
          />
        </div>
        <div className="flex items-center gap-2.5 px-3 py-2">
          <Palette className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
          <span className="flex-1 text-sm text-fg">Theme</span>
          <SegmentedControl ariaLabel="Theme" size="sm" value={mode} onChange={setMode} options={THEME_OPTIONS} />
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 px-1 text-xs text-fg-muted">
        <a
          href="https://github.com/Kombatant/retire-eh-reloaded"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[32px] items-center gap-1 hover:text-fg"
        >
          Source code
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
        <span className="inline-flex items-center gap-1 font-mono text-[11px]" title={`Build ${__APP_VERSION__}`}>
          <GitCommitHorizontal className="h-3.5 w-3.5" aria-hidden />
          {displayVersion(__APP_VERSION__)}
        </span>
      </div>
    </div>
  )
}

export function Sidebar() {
  return (
    <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 border-r border-border bg-surface lg:block">
      <SidebarContent />
    </aside>
  )
}
