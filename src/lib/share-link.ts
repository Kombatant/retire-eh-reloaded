import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate'
import { exportToYAML, importFromYAML, type ImportedPlan } from './yaml-utils'
import type { PlanV2 } from '@/lib/plan/schema'

const SHARE_PARAM = 'plan'

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

// Links created before v2 carry v1 YAML; importFromYAML migrates them.
export function decodePlan(encoded: string): ImportedPlan | null {
  try {
    const yaml = strFromU8(inflateSync(base64UrlToBytes(encoded)))
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
