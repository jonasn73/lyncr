"use client"

// Unlock sessionStorage after the server HTML and the first client render match.

import { useLayoutEffect, type ReactNode } from "react"
import { allowBrowserSessionCacheReads } from "@/lib/swr/persisted-cache"
import { useFlickerDebugLifecycle } from "@/lib/debug/flicker-debug"

export function SessionCacheHydrationGate({ children }: { children: ReactNode }) {
  const { log } = useFlickerDebugLifecycle("SessionCacheHydrationGate", {
    sessionReads: "gated",
  })
  // Runs before the browser paints, so lists can fill from session without a visible blank.
  useLayoutEffect(() => {
    allowBrowserSessionCacheReads()
    log("session-cache-unlocked", { sessionReads: "allowed" })
    // Unlock once on mount — log is a stable ref callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <>{children}</>
}
