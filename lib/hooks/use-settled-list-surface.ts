/**
 * Unified list surface: session seed → paint merge → held list → frozen rows.
 * Use for Messages inbox, CRM customers, and similar tenant lists.
 */

"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import { useSessionCacheReady } from "@/components/session-cache-hydration-gate"
import { useSessionSeed } from "@/lib/hooks/use-client-seed"
import { useHeldList } from "@/lib/hooks/use-held-list"
import { useFrozenVisibleList } from "@/lib/hooks/use-frozen-visible-list"

export type SettledListSurfaceOptions<T> = {
  scopeKey: string
  /** Bumps session re-read without resetting held/frozen scope (e.g. after cache write). */
  sessionRevision?: string | number
  empty: T[]
  orgReady: boolean
  readSession: () => T[]
  readPaint: () => T[]
  mergePaintWithSession: (paint: T[], session: T[]) => T[]
  mergeVisibleWithLive: (visible: T[], live: T[]) => T[]
  getId: (item: T) => string
}

export function useSettledListSurface<T>(opts: SettledListSurfaceOptions<T>) {
  const sessionReady = useSessionCacheReady()
  const sessionKey = `${opts.scopeKey}::r${opts.sessionRevision ?? 0}::s${sessionReady ? 1 : 0}`

  const sessionRows = useSessionSeed(
    () => (opts.orgReady ? opts.readSession() : opts.empty),
    opts.empty,
    sessionKey
  )

  // SSR paint always applies — never blank the list while org uuid is resolving.
  const paintRows = useMemo(() => opts.readPaint(), [opts.readPaint])

  const seedRows = useMemo(() => {
    const session = opts.orgReady ? sessionRows : opts.empty
    if (session.length === 0) return paintRows
    if (paintRows.length === 0) return session
    return opts.mergePaintWithSession(paintRows, session)
  }, [
    opts.empty,
    opts.orgReady,
    opts.mergePaintWithSession,
    sessionRows,
    paintRows,
  ])

  const [liveRows, setLiveRowsState] = useState<T[] | null>(null)
  const [networkSettled, setNetworkSettled] = useState(false)
  const rowsForCompareRef = useRef<T[]>(opts.empty)
  const rawRows = liveRows ?? seedRows

  const heldRows = useHeldList(rawRows, {
    scopeKey: opts.scopeKey,
    loading: !networkSettled && rawRows.length === 0,
  })

  const rows = useFrozenVisibleList(heldRows, {
    scopeKey: opts.scopeKey,
    settled: networkSettled,
    getId: opts.getId,
  })

  rowsForCompareRef.current = rows

  const setLiveRows = useCallback(
    (updater: T[] | ((prev: T[] | null) => T[] | null)) => {
      setLiveRowsState(updater)
    },
    []
  )

  const applyNetworkList = useCallback(
    (next: T[]) => {
      setLiveRowsState((prev) => {
        const baseline = prev ?? rowsForCompareRef.current
        if (baseline.length > 0) {
          return opts.mergeVisibleWithLive(baseline, next)
        }
        return next
      })
      setNetworkSettled(true)
    },
    [opts.mergeVisibleWithLive]
  )

  const resetSurface = useCallback(() => {
    setLiveRowsState(null)
    setNetworkSettled(false)
    rowsForCompareRef.current = opts.empty
  }, [opts.empty])

  const hasSeedRows = paintRows.length > 0 || sessionRows.length > 0

  return {
    rows,
    seedRows,
    paintRows,
    sessionRows,
    liveRows,
    networkSettled,
    setNetworkSettled,
    setLiveRows,
    applyNetworkList,
    resetSurface,
    hasSeedRows,
    rowsForCompareRef,
  }
}
