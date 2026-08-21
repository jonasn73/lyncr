"use client"

/**
 * Stable cold-load handoff for dashboard panes.
 * Real content stays in normal flow; fallback covers until first layout commit.
 * Never uses absolute/top-0 on the real tree (that pinned content to the viewport top).
 */

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { logFlicker } from "@/lib/debug/flicker-debug"

function PaneHandoffReady({ onReady }: { onReady: () => void }) {
  useLayoutEffect(() => {
    onReady()
  }, [onReady])
  return null
}

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
  const [layoutReady, setLayoutReady] = useState(false)
  const logRef = useRef({ ready: false, release: false })

  useLayoutEffect(() => {
    if (!holdGate) return
    setLayoutReady(false)
    logRef.current = { ready: false, release: false }
  }, [holdGate])

  const mountReal = !holdGate
  const showFallback = holdGate || !layoutReady

  const markReady = useCallback(() => {
    if (logRef.current.ready) {
      setLayoutReady(true)
      return
    }
    logRef.current.ready = true
    logFlicker({
      event: "pane-handoff-ready",
      component: probe,
      fallbackStillVisible: true,
      realSurfaceInFlow: true,
    })
    setLayoutReady(true)
  }, [probe])

  useLayoutEffect(() => {
    if (showFallback) return
    if (logRef.current.release) return
    logRef.current.release = true
    logFlicker({
      event: "pane-handoff-release",
      component: probe,
      fallbackAndRealOverlapped: true,
    })
  }, [showFallback, probe])

  return (
    <div className="relative w-full" data-flicker-probe={probe}>
      {mountReal ? (
        <div
          className="relative z-0"
          aria-hidden={showFallback}
          {...(showFallback ? { inert: true } : {})}
        >
          <PaneHandoffReady onReady={markReady} />
          {children}
        </div>
      ) : null}

      {showFallback ? (
        <div
          className={cn(
            "z-10 bg-background",
            mountReal ? "absolute inset-0 overflow-y-auto" : "relative"
          )}
          aria-busy="true"
        >
          {fallback}
        </div>
      ) : null}
    </div>
  )
}
