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
 *
 * CRITICAL (#185): with a no-op subscribe, getSnapshot MUST return a referentially
 * stable value across consecutive calls. Re-parsing storage every call and swapping
 * the cache when JSON differs (or key order / Date.now noise) makes React schedule
 * another render forever → “Maximum update depth exceeded”.
 */

import { useCallback, useRef, useState, useSyncExternalStore } from "react"

/** Subscribe that never fires — snapshots are frozen after the first client read per key. */
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
 *
 * After the first client read for a given `revisionKey`, the value is frozen for
 * that key (subscribeNever cannot safely observe storage writes). Pass a new
 * `revisionKey` (e.g. org id) when the seed source should be re-read.
 */
export function useClientSnapshot<T>(
  getClientSnapshot: () => T,
  getServerSnapshot: () => T,
  /** When this changes, re-read storage once (org switch, month change, …). */
  revisionKey: string | number | null | undefined = ""
): T {
  // Frozen snapshot for the current revisionKey (survives re-renders).
  const cacheRef = useRef<{ key: string | number | null | undefined; value: T } | undefined>(
    undefined
  )
  // Same value for every getSnapshot call inside one React consistency check.
  const passValueRef = useRef<T | undefined>(undefined)

  // New render → clear per-pass memo (cacheRef still freezes across renders).
  passValueRef.current = undefined

  const getStableClientSnapshot = () => {
    // Within one render / store check, always return the identical reference.
    if (passValueRef.current !== undefined) {
      return passValueRef.current
    }

    // Already froze a snapshot for this revision — never swap mid-flight (#185).
    if (cacheRef.current && cacheRef.current.key === revisionKey) {
      passValueRef.current = cacheRef.current.value
      return cacheRef.current.value
    }

    const next = getClientSnapshot()
    // If deep-equal to a prior freeze, keep that reference.
    if (cacheRef.current && defaultEqual(cacheRef.current.value, next)) {
      cacheRef.current = { key: revisionKey, value: cacheRef.current.value }
      passValueRef.current = cacheRef.current.value
      return cacheRef.current.value
    }

    cacheRef.current = { key: revisionKey, value: next }
    passValueRef.current = next
    return next
  }

  return useSyncExternalStore(subscribeNever, getStableClientSnapshot, getServerSnapshot)
}

/** True only after hydration — safe to treat storage-backed UI as authoritative. */
export function useIsClient(): boolean {
  return useClientSnapshot(
    () => true,
    () => false,
    "is-client"
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
