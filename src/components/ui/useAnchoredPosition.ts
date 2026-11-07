import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react'

const GUTTER = 8 // keep floating elements this far from the viewport edge
const GAP = 6 // distance from the anchor

export interface FloatingPosition {
  top: number
  left: number
  maxHeight: number
}

// Place a floating element next to an anchor: below (or above if there is
// more room there) and horizontally aligned, clamped inside the viewport.
export function useAnchoredPosition(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  floatingRef: RefObject<HTMLElement | null>,
  opts: { prefer: 'below' | 'above'; align: 'start' | 'center' | 'end' },
): FloatingPosition | null {
  const [position, setPosition] = useState<FloatingPosition | null>(null)

  const update = useCallback(() => {
    const anchor = anchorRef.current
    const floating = floatingRef.current
    if (!anchor || !floating) return
    const a = anchor.getBoundingClientRect()
    const width = floating.offsetWidth
    const height = floating.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight

    const spaceBelow = vh - a.bottom - GAP - GUTTER
    const spaceAbove = a.top - GAP - GUTTER
    const below = opts.prefer === 'below' ? spaceBelow >= Math.min(height, 240) || spaceBelow >= spaceAbove : spaceAbove < height && spaceBelow > spaceAbove
    const maxHeight = Math.max(120, below ? spaceBelow : spaceAbove)
    const shown = Math.min(height, maxHeight)
    const top = below ? a.bottom + GAP : a.top - GAP - shown

    let left = opts.align === 'start' ? a.left : opts.align === 'end' ? a.right - width : a.left + a.width / 2 - width / 2
    left = Math.min(Math.max(GUTTER, left), Math.max(GUTTER, vw - width - GUTTER))
    setPosition({ top, left, maxHeight })
  }, [anchorRef, floatingRef, opts.prefer, opts.align])

  useLayoutEffect(() => {
    if (!open) return
    update()
  }, [open, update])

  useEffect(() => {
    if (!open) return
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [open, update])

  return open ? position : null
}
