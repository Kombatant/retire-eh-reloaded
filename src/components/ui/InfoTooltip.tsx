import { Info } from 'lucide-react'
import { Tooltip } from './Floating'

interface InfoTooltipProps {
  text: string
}

export function InfoTooltip({ text }: InfoTooltipProps) {
  return (
    <Tooltip content={text}>
      <span
        tabIndex={0}
        role="button"
        aria-label={`More info: ${text}`}
        className="inline-flex rounded-full text-fg-muted hover:text-fg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Info className="ml-0.5 inline-block h-3.5 w-3.5 shrink-0 cursor-help" aria-hidden />
      </span>
    </Tooltip>
  )
}
