import type { ComponentType, HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/ui/cn'

interface CardProps extends HTMLAttributes<HTMLElement> {
  // Inner padding. 'none' is for cards whose content (a table) runs to the edge.
  padding?: 'none' | 'md' | 'lg'
  as?: 'section' | 'div' | 'article'
}

const paddingClass = { none: '', md: 'p-4 sm:p-5', lg: 'p-5 sm:p-6' }

export function Card({ padding = 'md', as: Tag = 'section', className, children, ...rest }: CardProps) {
  return (
    <Tag
      className={cn('rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(16,24,40,0.04)]', paddingClass[padding], className)}
      {...rest}
    >
      {children}
    </Tag>
  )
}

interface CardHeaderProps {
  title: ReactNode
  description?: ReactNode
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  actions?: ReactNode
  className?: string
}

export function CardHeader({ title, description, icon: Icon, actions, className }: CardHeaderProps) {
  return (
    <div className={cn('mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2', className)}>
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-fg">
          {Icon && <Icon className="h-4 w-4 text-fg-muted" aria-hidden />}
          {title}
        </h2>
        {description && <p className="mt-0.5 text-[13px] text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
