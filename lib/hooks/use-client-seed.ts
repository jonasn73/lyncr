"use client"

/**
 * Session-seed helpers — #185-safe.
 *
 * Do NOT use useSyncExternalStore here. That pattern caused React #185
 * (max update depth) on lyncr.app when storage re-reads churned.
 *
 * Safe approach: paint SSR fallback first, then hydrate once from
 * sessionStorage/localStorage in useLayoutEffect (before browser paint).
 */

import { useCallback, useEffect, useLayoutEffect, useState } from "react"

/**
 * @deprecated Prefer useSessionSeed. Kept as a no-op so old call sites compile;
 * it never reads storage (avoids #185).
 */
export function useClientSnapshot<T>(
  _getClientSnapshot: () => T,
  getServerSnapshot: () => T,
  _revisionKey: string | number | null | undefined = ""
): T {
  void _getClientSnapshot
  void _revisionKey
  return getServerSnapshot()
}

/**
 * Last-known session value before paint — safe replacement for useClientSnapshot.
 *
 * - First render: `serverFallback` (SSR / hydration match)
 * - useLayoutEffect: read storage once per `revisionKey`, setState before paint
 * - No external-store subscription → no #185 loops from JSON re-reads
 *
 * @param read - Must return a stable empty sentinel on cache miss (same reference).
 * @param serverFallback - Same sentinel used on the server.
 * @param revisionKey - Re-read when org / filter / etc. changes (not on every render).
 */
export function useSessionSeed<T>(
  read: () => T,
  serverFallback: T,
  revisionKey: string | number | null | undefined = ""
): T {
  const [value, setValue] = useState<T>(serverFallback)

  useLayoutEffect(() => {
    let next: T
    try {
      next = read()
    } catch {
      return
    }
    // Always apply — callers use stable EMPTY_* refs on miss, so Object.is often skips churn.
    setValue((prev) => (Object.is(prev, next) ? prev : next))
    // Intentionally omit `read` — it is usually an inline closure; revisionKey gates re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- #185: never depend on read identity
  }, [revisionKey])

  return value
}

/** True after mount — safe for browser-only UI without useSyncExternalStore. */
export function useIsClient(): boolean {
  const [isClient, setIsClient] = useState(false)
  useEffect(() => {
    setIsClient(true)
  }, [])
  return isClient
}

/**
 * Display value = live override ?? session seed ?? serverFallback.
 * Seed hydrates once via useSessionSeed (no useSyncExternalStore).
 */
export function useSeededDisplay<T>(
  readSeed: () => T | null | undefined,
  serverFallback: T,
  revisionKey: string | number | null | undefined = ""
): {
  value: T
  ready: boolean
  setLive: (next: T | ((prev: T) => T)) => void
  clearLive: () => void
} {
  const seed = useSessionSeed(
    () => {
      const fromStorage = readSeed()
      return fromStorage == null ? serverFallback : fromStorage
    },
    serverFallback,
    revisionKey
  )
  const [live, setLiveState] = useState<T | null>(null)

  const setLive = useCallback(
    (next: T | ((prev: T) => T)) => {
      setLiveState((prev) => {
        const base = prev ?? seed
        return typeof next === "function" ? (next as (p: T) => T)(base) : next
      })
    },
    [seed]
  )

  const clearLive = useCallback(() => {
    setLiveState(null)
  }, [])

  const value = live ?? seed
  const ready = live != null || !Object.is(seed, serverFallback)

  return { value, ready, setLive, clearLive }
}
