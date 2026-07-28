"use client"

/**
 * Client-seed helpers — stop hard-refresh flashes from SSR defaults.
 *
 * React keeps useState() from the server on hydrate, so localStorage/sessionStorage
 * reads in useState(() => …) never run on the client. useLayoutEffect runs too late
 * for the first painted frame after JS loads when SSR HTML already showed wrong UI.
 *
 * useSyncExternalStore is the supported way to read a browser store that differs
 * from the server: SSR uses getServerSnapshot; after hydrate, getClientSnapshot wins
 * in the same commit as hydration (no “Available → Busy” / “$0 → $real” blink).
 */

import { useCallback, useRef, useState, useSyncExternalStore } from "react"

/** Subscribe that never fires — snapshots are re-read each render from storage. */
function subscribeNever(): () => void {
  return () => {}
}

function defaultEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true
  // Stabilize JSON.parse / plain-object seeds so useSyncExternalStore doesn’t loop.
  if (
    a != null &&
    b != null &&
    typeof a === "object" &&
    typeof b === "object"
  ) {
    try {
      return JSON.stringify(a) === JSON.stringify(b)
    } catch {
      return false
    }
  }
  return false
}

/**
 * Browser-only snapshot (sessionStorage / localStorage / cookies).
 * `getServerSnapshot` must be pure and match the SSR HTML you want before JS.
 * Object snapshots are referentially stabilized when deep-equal.
 */
export function useClientSnapshot<T>(
  getClientSnapshot: () => T,
  getServerSnapshot: () => T
): T {
  const cacheRef = useRef<T | undefined>(undefined)

  const getStableClientSnapshot = () => {
    const next = getClientSnapshot()
    if (cacheRef.current !== undefined && defaultEqual(cacheRef.current, next)) {
      return cacheRef.current
    }
    cacheRef.current = next
    return next
  }

  return useSyncExternalStore(subscribeNever, getStableClientSnapshot, getServerSnapshot)
}

/** True only after hydration — safe to treat storage-backed UI as authoritative. */
export function useIsClient(): boolean {
  return useClientSnapshot(
    () => true,
    () => false
  )
}

/**
 * Display value = live override (API / user) ?? client seed ?? serverFallback.
 * Seed paints immediately on the client; setLive updates after fetch or interaction.
 */
export function useSeededDisplay<T>(
  readSeed: () => T | null | undefined,
  serverFallback: T
): {
  value: T
  /** True when seed or live data is available (not bare server fallback alone). */
  ready: boolean
  setLive: (next: T | ((prev: T) => T)) => void
  /** Clear live override so seed shows again (rare — org switch). */
  clearLive: () => void
} {
  const seed = useClientSnapshot(() => {
    const v = readSeed()
    return v === null || v === undefined ? null : v
  }, () => null)

  const [live, setLiveState] = useState<T | null>(null)

  const setLive = useCallback(
    (next: T | ((prev: T) => T)) => {
      setLiveState((prev) => {
        const base = prev ?? seed ?? serverFallback
        return typeof next === "function" ? (next as (p: T) => T)(base) : next
      })
    },
    [seed, serverFallback]
  )

  const clearLive = useCallback(() => {
    setLiveState(null)
  }, [])

  const value = live ?? seed ?? serverFallback
  const ready = live != null || seed != null

  return { value, ready, setLive, clearLive }
}
