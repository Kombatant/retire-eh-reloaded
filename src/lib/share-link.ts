import { deflateSync, Inflate, strFromU8, strToU8 } from 'fflate'
import { exportToYAML, importFromYAML, MAX_IMPORT_BYTES, type ImportedPlan } from './yaml-utils'
import type { PlanV2 } from '@/lib/plan/schema'

const SHARE_PARAM = 'plan'
const MAX_ENCODED_LINK = 128 * 1024
const INFLATE_SLICE = 1024

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export function encodePlan(plan: PlanV2): string {
  const yaml = exportToYAML(plan)
  return bytesToBase64Url(deflateSync(strToU8(yaml), { level: 9 }))
}

// A link's size is checked before and during decompression: a few kilobytes
// can inflate to gigabytes. Input goes in small slices so the limit bites early.
function inflateWithinLimit(bytes: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = []
  let size = 0
  const inflater = new Inflate((chunk) => {
    size += chunk.length
    if (size > MAX_IMPORT_BYTES) throw new Error('Decompressed plan is too large.')
    chunks.push(chunk)
  })
  for (let i = 0; i < bytes.length; i += INFLATE_SLICE) {
    inflater.push(bytes.subarray(i, i + INFLATE_SLICE), i + INFLATE_SLICE >= bytes.length)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

// Links created before v2 carry v1 YAML; importFromYAML migrates them.
export function decodePlan(encoded: string): ImportedPlan | null {
  try {
    if (encoded.length > MAX_ENCODED_LINK) return null
    const yaml = strFromU8(inflateWithinLimit(base64UrlToBytes(encoded)))
    return importFromYAML(yaml)
  } catch {
    return null
  }
}

export function buildShareUrl(plan: PlanV2, baseUrl: string = window.location.href): string {
  const url = new URL(baseUrl)
  url.hash = `${SHARE_PARAM}=${encodePlan(plan)}`
  return url.toString()
}

export function readSharePlanFromUrl(href: string): ImportedPlan | null {
  try {
    const url = new URL(href)
    const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
    const encoded = new URLSearchParams(hash).get(SHARE_PARAM)
    return encoded ? decodePlan(encoded) : null
  } catch {
    return null
  }
}

export function clearShareHash(): void {
  const url = new URL(window.location.href)
  url.hash = ''
  window.history.replaceState(null, '', url.toString())
}
