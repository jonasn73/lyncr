"use client"

/**
 * Cold-load handoff for dashboard panes.
 * While holdGate: fallback only.
 * When holdGate clears: show real content immediately (do NOT re-arm the cover —
 * that left Activity/Messages stuck on skeletons forever).
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { logFlicker } from "@/lib/debug/flicker-debug"

export function WorkspacePaneHandoff({
  holdGate = false,
  fallback,
  children,
  probe = "pane-handoff",
}: {
  /** When true, only the fallback mounts (data not ready for the real tree). */
  holdGate?: boolean
  fallback: ReactNode
  children: ReactNode
  probe?: string
}) {
  const prevHoldRef = useRef(holdGate)
  // Track releases for flicker probes only (no second cover layer).
  const releasedRef = useRef(!holdGate)

  useLayoutEffect(() => {
    const wasHolding = prevHoldRef.current
    prevHoldRef.current = holdGate
    if (holdGate) {
      releasedRef.current = false
      return
    }
    if (wasHolding && !releasedRef.current) {
      releasedRef.current = true
      logFlicker({
        event: "pane-handoff-release",
        component: probe,
        fallbackAndRealOverlapped: false,
      })
    }
  }, [holdGate, probe])

  if (holdGate) {
    return (
      <div className="relative w-full" data-flicker-probe={probe}>
        <div className="relative z-10 bg-background" aria-busy="true">
          {fallback}
        </div>
      </div>
    )
  }

  return (
    <div className="relative w-full" data-flicker-probe={probe}>
      {children}
    </div>
  )
}
