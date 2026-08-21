/**
 * Keep the last non-empty list while loading/validating so the UI does not
 * flash empty → rows. App-wide — Scheduler pipeline, job pool, CRM lists, etc.
 */

"use client"

import { useMemo, useRef } from "react"

/**
 * Clears hold when `scopeKey` changes (day/org/month).
 */
export function useHeldList<T>(
  items: T[],
  opts: {
    scopeKey: string
    loading?: boolean
    validating?: boolean
    /** When false, do not return held rows (force empty). Default true. */
    allowHold?: boolean
  }
): T[] {
  const holdRef = useRef<{ scopeKey: string; items: T[] }>({
    scopeKey: opts.scopeKey,
    items: [],
  })

  return useMemo(() => {
    if (holdRef.current.scopeKey !== opts.scopeKey) {
      holdRef.current = { scopeKey: opts.scopeKey, items }
      return items
    }
    if (items.length > 0) {
      holdRef.current = { scopeKey: opts.scopeKey, items }
      return items
    }
    const allowHold = opts.allowHold !== false
    if (allowHold && (opts.loading || opts.validating)) {
      return holdRef.current.items
    }
    holdRef.current = { scopeKey: opts.scopeKey, items: [] }
    return items
  }, [items, opts.scopeKey, opts.loading, opts.validating, opts.allowHold])
}
