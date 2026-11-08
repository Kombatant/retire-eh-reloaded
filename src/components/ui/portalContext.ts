import { createContext, useContext } from 'react'

// A modal <dialog> makes everything outside it inert, so menus and tooltips
// opened from inside a sheet must be portalled into the dialog, not <body>.
export const PortalContainerContext = createContext<HTMLElement | null>(null)

export function usePortalContainer(): HTMLElement | null {
  return useContext(PortalContainerContext)
}
