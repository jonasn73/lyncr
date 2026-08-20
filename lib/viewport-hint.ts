// Remember phone vs computer so refresh HTML matches the real screen.

import { MOBILE_BREAKPOINT_PX } from "@/lib/mobile-shell"

/** Cookie written on the device; the server reads it on the next refresh. */
export const VIEWPORT_COOKIE = "lyncr_vw"

/** Set by middleware from the cookie or the browser’s mobile hint. */
export const VIEWPORT_MOBILE_HEADER = "x-lyncr-mobile"

/** True = phone-sized, false = computer-sized, null = we do not know yet. */
export type ViewportMobileHint = boolean | null

/**
 * Decide phone vs computer from last-visit cookie and optional browser hints.
 * Cookie wins so a refresh on a phone is not built as a wide computer page.
 */
export function parseViewportIsMobile(
  cookieValue?: string | null,
  clientHintMobile?: string | null,
  clientHintWidth?: string | null
): ViewportMobileHint {
  const cookie = cookieValue?.trim()
  if (cookie === "1") return true
  if (cookie === "0") return false
  const ch = clientHintMobile?.trim()
  if (ch === "?1") return true
  if (ch === "?0") return false
  const width = Number(clientHintWidth)
  if (Number.isFinite(width) && width > 0) return width < MOBILE_BREAKPOINT_PX
  return null
}

/** Cookie value stored on the device. */
export function viewportCookieValue(isMobile: boolean): "1" | "0" {
  return isMobile ? "1" : "0"
}

/** Tiny script: save phone/computer before React runs (helps the next refresh). */
export const VIEWPORT_BOOTSTRAP_SCRIPT = `(function(){try{var m=window.matchMedia("(max-width:${MOBILE_BREAKPOINT_PX - 1}px)").matches;document.cookie="${VIEWPORT_COOKIE}="+(m?"1":"0")+"; Path=/; Max-Age=31536000; SameSite=Lax";document.documentElement.dataset.lyncrVw=m?"mobile":"desktop";}catch(e){}})();`
