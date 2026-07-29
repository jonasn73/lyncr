"use client"

/**
 * Session-seed helpers — DISABLED.
 *
 * useSyncExternalStore + storage re-reads caused React #185 (max update depth)
 * on lyncr.app even after freeze patches (1adfa88). Dashboard shell must load.
 *
 * These exports keep call-site shapes compiling but never read session/local
 * storage and never subscribe to an external store. Live data comes from
 * normal fetch / SWR / useEffect paths only.
 */

import { useCallback, useEffect, useState } from "react"

/**
 * Always returns the SSR/server fallback. Client storage seeds are intentionally off.
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

/** True after mount — safe for browser-only UI without useSyncExternalStore. */
export function useIsClient(): boolean {
  const [isClient, setIsClient] = useState(false)
  useEffect(() => {
    setIsClient(true)
  }, [])
  return isClient
}

/**
 * Display value = live override ?? serverFallback (no storage seed).
 */
export function useSeededDisplay<T>(
  _readSeed: () => T | null | undefined,
  serverFallback: T
): {
  value: T
  ready: boolean
  setLive: (next: T | ((prev: T) => T)) => void
  clearLive: () => void
} {
  void _readSeed
  const [live, setLiveState] = useState<T | null>(null)

  const setLive = useCallback(
    (next: T | ((prev: T) => T)) => {
      setLiveState((prev) => {
        const base = prev ?? serverFallback
        return typeof next === "function" ? (next as (p: T) => T)(base) : next
      })
    },
    [serverFallback]
  )

  const clearLive = useCallback(() => {
    setLiveState(null)
  }, [])

  const value = live ?? serverFallback
  const ready = live != null

  return { value, ready, setLive, clearLive }
}
