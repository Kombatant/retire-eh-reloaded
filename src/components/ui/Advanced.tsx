import type { ReactNode } from 'react'
import { useDetailLevel } from '@/hooks/useDetailLevel'

// Renders its children only in Advanced mode.
export function Advanced({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const { isAdvanced } = useDetailLevel()
  return <>{isAdvanced ? children : fallback}</>
}
