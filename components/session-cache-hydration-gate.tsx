"use client"

// Unlock sessionStorage after the server HTML and the first client render match.

import { useLayoutEffect, type ReactNode } from "react"
import { allowBrowserSessionCacheReads } from "@/lib/swr/persisted-cache"

export function SessionCacheHydrationGate({ children }: { children: ReactNode }) {
  // Runs before the browser paints, so lists can fill from session without a visible blank.
  useLayoutEffect(() => {
    allowBrowserSessionCacheReads()
  }, [])
  return <>{children}</>
}
