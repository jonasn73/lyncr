"use client"

/**
 * Unlock sessionStorage after the first client render matches SSR HTML,
 * then tell every useSessionSeed to re-read before the browser paints.
 *
 * Why: child useLayoutEffects run before this parent. If we only unlock here
 * and never bump a revision, Activity/CRM/Messages stay on skeleton until
 * the network returns — the multi-second flash owners keep reporting.
 */

import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react"
import { allowBrowserSessionCacheReads } from "@/lib/swr/persisted-cache"
import { useFlickerDebugLifecycle } from "@/lib/debug/flicker-debug"

const SessionCacheReadyContext = createContext(false)

/** True after sessionStorage reads are allowed (same frame as unlock, before paint). */
export function useSessionCacheReady(): boolean {
  return useContext(SessionCacheReadyContext)
}

export function SessionCacheHydrationGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const { log } = useFlickerDebugLifecycle("SessionCacheHydrationGate", {
    sessionReads: ready ? "allowed" : "gated",
  })

  useLayoutEffect(() => {
    allowBrowserSessionCacheReads()
    setReady(true)
    log("session-cache-unlocked", { sessionReads: "allowed" })
    // Unlock once on mount — log is a stable ref callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <SessionCacheReadyContext.Provider value={ready}>{children}</SessionCacheReadyContext.Provider>
  )
}
