"use client"

/**
 * Session-seed helpers — #185-safe.
 *
 * Do NOT use useSyncExternalStore here. That pattern caused React #185
 * (max update depth) on lyncr.app when storage re-reads churned.
 *
 * Prefer lazy useState(() => read()) so client-only mounts paint cached
 * values on the first render. For SSR-hydrated trees, React reuses the
 * server state (initializer does not re-run) — useLayoutEffect re-reads
 * once per revisionKey before browser paint.
 *
 * Also re-reads when SessionCacheHydrationGate flips ready (session unlock)
 * so hard refresh is not stuck on skeleton waiting for the network.
 */

import { useCallback, useEffect, useLayoutEffect, useState } from "react"
import { useSessionCacheReady } from "@/components/session-cache-hydration-gate"

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
 * Last-known session value on first client paint — safe replacement for useClientSnapshot.
 *
 * - Lazy useState: reads storage synchronously when the initializer runs (client mounts)
 * - useLayoutEffect: re-reads once per revisionKey (fixes SSR hydration + org switches)
 * - Re-reads when session cache unlocks (hard refresh → instant list, not network wait)
 * - No external-store subscription → no #185 loops from JSON re-reads
 *
 * @param read - Must return a stable empty sentinel on cache miss (same reference).
 * @param serverFallback - Same sentinel used on the server / SSR HTML.
 * @param revisionKey - Re-read when org / filter / etc. changes (not on every render).
 */
export function useSessionSeed<T>(
  read: () => T,
  serverFallback: T,
  revisionKey: string | number | null | undefined = ""
): T {
  const sessionReady = useSessionCacheReady()
  const effectiveKey = `${revisionKey ?? ""}::s${sessionReady ? 1 : 0}`

  const [value, setValue] = useState<T>(() => {
    try {
      return read()
    } catch {
      return serverFallback
    }
  })

  useLayoutEffect(() => {
    let next: T
    try {
      next = read()
    } catch {
      return
    }
    setValue((prev) => (Object.is(prev, next) ? prev : next))
    // Intentionally omit `read` — it is usually an inline closure; effectiveKey gates re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- #185: never depend on read identity
  }, [effectiveKey])

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
