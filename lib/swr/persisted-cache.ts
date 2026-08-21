/** Session-scoped SWR fallback cache (cleared when the browser tab closes). */

const CACHE_VERSION = 1
/** Default TTL for generic session caches (leads, numbers, etc.). */
const MAX_AGE_MS = 30 * 60 * 1000

type PersistedEnvelope<T> = {
  v: number
  t: number
  data: T
}

// First HTML cannot see sessionStorage — reading it during hydrate mismatched SSR
// and React threw away the page. SessionCacheHydrationGate unlocks in useLayoutEffect
// and bumps useSessionCacheReady so every useSessionSeed re-reads before paint.
let browserSessionReadsAllowed =
  typeof process !== "undefined" &&
  (process.env.NODE_ENV === "test" || Boolean(process.env.VITEST))

/** Turn on sessionStorage reads after hydrate matches the server HTML. */
export function allowBrowserSessionCacheReads(): void {
  browserSessionReadsAllowed = true
}

/** True when sessionStorage may be used during render. */
export function browserSessionCacheReadsAllowed(): boolean {
  return browserSessionReadsAllowed
}

function getSessionStorage(): Storage | null {
  try {
    if (typeof sessionStorage === "undefined") return null
    return sessionStorage
  } catch {
    return null
  }
}

export function persistedCacheKey(scope: string, id: string): string {
  return `lyncr:swr:v${CACHE_VERSION}:${scope}:${id}`
}

export function readPersistedCache<T>(key: string, opts?: { maxAgeMs?: number }): T | undefined {
  if (!browserSessionReadsAllowed) return undefined
  const storage = getSessionStorage()
  if (!storage) return undefined
  try {
    const raw = storage.getItem(key)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as PersistedEnvelope<T>
    // Allow falsy payloads (false, 0, "") — only reject missing envelope fields.
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.v !== CACHE_VERSION ||
      !("data" in parsed) ||
      parsed.data === undefined
    ) {
      return undefined
    }
    const maxAgeMs = opts?.maxAgeMs ?? MAX_AGE_MS
    if (Date.now() - parsed.t > maxAgeMs) {
      storage.removeItem(key)
      return undefined
    }
    return parsed.data
  } catch {
    return undefined
  }
}

export function writePersistedCache<T>(key: string, data: T): void {
  const storage = getSessionStorage()
  if (!storage) return
  try {
    const envelope: PersistedEnvelope<T> = { v: CACHE_VERSION, t: Date.now(), data }
    storage.setItem(key, JSON.stringify(envelope))
  } catch {
    /* quota or private mode — ignore */
  }
}
