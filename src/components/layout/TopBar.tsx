import { Download, Menu, MoreHorizontal, Share2, Upload } from 'lucide-react'
import { Button, IconButton } from '@/components/ui/Button'
import { DropdownMenu } from '@/components/ui/Floating'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { PlanMenu } from './PlanMenu'
import { BRAND_ICON } from './navItems'

interface TopBarProps {
  showRealValues: boolean
  onSetRealValues: (real: boolean) => void
  onExport: () => void
  onImport: () => void
  onShare: () => void
  onOpenNav: () => void
}

export function TopBar({ showRealValues, onSetRealValues, onExport, onImport, onShare, onOpenNav }: TopBarProps) {
  const Brand = BRAND_ICON
  return (
    <header className="sticky top-0 z-30 h-14 border-b border-border bg-surface">
      <div className="flex h-full items-center gap-2 px-3 sm:px-4">
        <IconButton icon={Menu} label="Open navigation" onClick={onOpenNav} className="lg:hidden" />
        <div className="flex items-center gap-2 lg:w-[13.25rem]">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-accent-fg">
            <Brand className="h-4 w-4" aria-hidden />
          </span>
          <span className="hidden text-[15px] font-semibold tracking-tight text-fg sm:inline">Retire, Eh?</span>
        </div>
        <span className="hidden h-5 w-px bg-border sm:block" aria-hidden />
        <PlanMenu />

        <div className="ml-auto flex items-center gap-2">
          <SegmentedControl
            ariaLabel="Dollars shown"
            size="sm"
            value={showRealValues ? 'real' : 'nominal'}
            onChange={(v) => onSetRealValues(v === 'real')}
            options={[
              { value: 'real', label: <><span className="sm:hidden">Today</span><span className="hidden sm:inline">Today's $</span></>, title: "Today's purchasing power (inflation removed)" },
              { value: 'nominal', label: <><span className="sm:hidden">Future</span><span className="hidden sm:inline">Future $</span></>, title: 'Dollars of each future year (inflation included)' },
            ]}
          />
          {/* The ⋯ menu also has Share; the button is a shortcut on wider screens. */}
          <span className="hidden md:block">
            <Button variant="primary" size="sm" icon={Share2} onClick={onShare}>Share</Button>
          </span>
          <DropdownMenu
            buttonLabel="More actions"
            buttonClassName="inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-secondary hover:bg-surface-muted hover:text-fg"
            label={<MoreHorizontal className="h-4 w-4" aria-hidden />}
            items={[
              { key: 'share', label: 'Copy share link', icon: Share2, onSelect: onShare },
              { key: 'export', label: 'Export plan (YAML)', icon: Download, onSelect: onExport, separator: true },
              { key: 'import', label: 'Import plan (YAML)…', icon: Upload, onSelect: onImport },
            ]}
          />
        </div>
      </div>
    </header>
  )
}
