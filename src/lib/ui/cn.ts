// Joins class names, skipping falsy parts. Small enough not to need a library.
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
