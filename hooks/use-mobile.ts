import * as React from "react"

import { MOBILE_BREAKPOINT_PX } from "@/lib/mobile-shell"
import { VIEWPORT_COOKIE, viewportCookieValue } from "@/lib/viewport-hint"
import { useViewportHint } from "@/components/viewport-hint-provider"

export function useIsMobile() {
  // Cookie/header from the server — must match first HTML (do not read window here).
  const hinted = useViewportHint()
  const [isMobile, setIsMobile] = React.useState(() => hinted === true)

  React.useLayoutEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`)
    const apply = () => {
      const next = mql.matches
      setIsMobile(next)
      try {
        document.cookie = `${VIEWPORT_COOKIE}=${viewportCookieValue(next)}; Path=/; Max-Age=31536000; SameSite=Lax`
      } catch {
        /* private mode */
      }
    }
    apply()
    mql.addEventListener("change", apply)
    return () => mql.removeEventListener("change", apply)
  }, [])

  return isMobile
}
