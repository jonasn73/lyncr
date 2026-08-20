"use client"

// Pass the server’s phone/computer guess into useIsMobile so SSR matches hydrate.

import { createContext, useContext, type ReactNode } from "react"
import type { ViewportMobileHint } from "@/lib/viewport-hint"

const ViewportHintContext = createContext<ViewportMobileHint>(null)

export function ViewportHintProvider({
  initialIsMobile,
  children,
}: {
  initialIsMobile: ViewportMobileHint
  children: ReactNode
}) {
  return (
    <ViewportHintContext.Provider value={initialIsMobile}>{children}</ViewportHintContext.Provider>
  )
}

/** Server hint for this request — null when the cookie/header was missing. */
export function useViewportHint(): ViewportMobileHint {
  return useContext(ViewportHintContext)
}
