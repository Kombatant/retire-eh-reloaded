import { createContext, useContext } from 'react'

// <Field> provides the id its <label> points at; inputs inside it pick the id
// up automatically, so callers never wire htmlFor/id pairs by hand.
export const FieldIdContext = createContext<string | undefined>(undefined)

export function useFieldId(explicit?: string): string | undefined {
  const fromField = useContext(FieldIdContext)
  return explicit ?? fromField
}
