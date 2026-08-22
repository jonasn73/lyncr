"use client"

/**
 * Session-seed helpers — #185-safe.
 *
 * useSessionSeed reads synchronously when revision/session key changes (no
 * useLayoutEffect lag) so paint → session unlock does not flash an extra frame.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
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
 * Last-known session value — re-reads synchronously when revisionKey or session
 * unlock changes (same render pass as SessionCacheHydrationGate flip).
 */
export function useSessionSeed<T>(
  read: () => T,
  serverFallback: T,
  revisionKey: string | number | null | undefined = ""
): T {
  const sessionReady = useSessionCacheReady()
  const effectiveKey = `${revisionKey ?? ""}::s${sessionReady ? 1 : 0}`

  return useMemo(() => {
    try {
      return read()
    } catch {
      return serverFallback
    }
    // Intentionally omit `read` — inline closures; effectiveKey gates re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveKey, serverFallback])
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
