/** Session-scoped SWR fallback cache (cleared when the browser tab closes). */

const CACHE_VERSION = 1
/** Default TTL for generic session caches (leads, numbers, etc.). */
const MAX_AGE_MS = 30 * 60 * 1000

type PersistedEnvelope<T> = {
  v: number
  t: number
  data: T
}

export function persistedCacheKey(scope: string, id: string): string {
  return `lyncr:swr:v${CACHE_VERSION}:${scope}:${id}`
}

export function readPersistedCache<T>(key: string, opts?: { maxAgeMs?: number }): T | undefined {
  if (typeof window === "undefined") return undefined
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as PersistedEnvelope<T>
    if (parsed.v !== CACHE_VERSION || !parsed.data) return undefined
    const maxAgeMs = opts?.maxAgeMs ?? MAX_AGE_MS
    if (Date.now() - parsed.t > maxAgeMs) {
      sessionStorage.removeItem(key)
      return undefined
    }
    return parsed.data
  } catch {
    return undefined
  }
}

export function writePersistedCache<T>(key: string, data: T): void {
  if (typeof window === "undefined") return
  try {
    const envelope: PersistedEnvelope<T> = { v: CACHE_VERSION, t: Date.now(), data }
    sessionStorage.setItem(key, JSON.stringify(envelope))
  } catch {
    /* quota or private mode — ignore */
  }
}
