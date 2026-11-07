import { Tooltip } from '@/components/ui/Floating'

interface InfoTooltipProps {
  text: string
}

export function InfoTooltip({ text }: InfoTooltipProps) {
  return (
    <Tooltip content={text}>
      <span tabIndex={0} role="button" aria-label={`More info: ${text}`} className="inline-flex rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="inline-block w-4 h-4 ml-1 text-indigo-500 cursor-help flex-shrink-0" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
        </svg>
      </span>
    </Tooltip>
  )
}
