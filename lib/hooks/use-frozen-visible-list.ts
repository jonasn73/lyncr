/**
 * Keep row objects stable per id for a scope — stops name/status rewrites when
 * session unlocks, SWR revalidates, or networkSettled flips (Linear-style cells).
 * Never swaps frozen objects for live ones on the same id within a scope.
 */

"use client"

import { useMemo, useRef } from "react"

export function useFrozenVisibleList<T>(
  items: T[],
  opts: {
    scopeKey: string
    /** @deprecated Settled no longer clears freeze — merge at applyNetworkList instead. */
    settled?: boolean
    getId: (item: T) => string
  }
): T[] {
  const holdRef = useRef<{ scopeKey: string; byId: Map<string, T> }>({
    scopeKey: opts.scopeKey,
    byId: new Map(),
  })
  // Keep getId out of useMemo deps — inline (row) => row.id would re-freeze every render.
  const getIdRef = useRef(opts.getId)
  getIdRef.current = opts.getId

  return useMemo(() => {
    if (holdRef.current.scopeKey !== opts.scopeKey) {
      holdRef.current = { scopeKey: opts.scopeKey, byId: new Map() }
    }
    const out: T[] = []
    for (const item of items) {
      const id = getIdRef.current(item)
      const frozen = holdRef.current.byId.get(id)
      if (frozen) {
        out.push(frozen)
      } else {
        holdRef.current.byId.set(id, item)
        out.push(item)
      }
    }
    return out
  }, [items, opts.scopeKey])
}
