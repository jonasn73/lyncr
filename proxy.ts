// ============================================
// Proxy — session cookie gate for /dashboard/*, /admin/*, and /onboarding
// ============================================
// Renamed from middleware.ts for Next 16. Note that Proxy defaults to the
// Node.js runtime, where Middleware defaulted to Edge, and the runtime option
// is not configurable here — see the instant-greeting note below.
//
// Only checks that the session cookie exists (shape: payload.signature).
// Real signature + expiry validation stays in /api/auth/session (Node).
// This avoids a full-screen loading spinner and reduces “wrong page then correct page” flashes.

import {
  VIEWPORT_COOKIE,
  VIEWPORT_MOBILE_HEADER,
  parseViewportIsMobile,
  viewportCookieValue,
} from "@/lib/viewport-hint"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import {
  buildEdgeInstantGreetingTexml,
  buildEdgeInboundGreetingContinueUrl,
  shouldEdgeInstantGreetingIntercept,
} from "@/lib/inbound-instant-greet-edge"

/** Must match lib/auth.ts COOKIE_NAME (plus legacy zing_session dual-read). */
const LYNCR_SESSION = "lyncr_session"
const LEGACY_ZING_SESSION = "zing_session"

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Pass 1 inbound greeting — answers before the route handler does, so Telnyx is
  // not left ringing through a cold start. This was written when this file was
  // Edge middleware; Proxy runs on Node, so the head start is smaller than the
  // original comment implied. Still ahead of the route, still worth having.
  if (shouldEdgeInstantGreetingIntercept(pathname, request.nextUrl, request.method)) {
    const continueUrl = buildEdgeInboundGreetingContinueUrl(request.url)
    const xml = buildEdgeInstantGreetingTexml(continueUrl)
    return new NextResponse(xml, {
      status: 200,
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "Cache-Control": "no-store",
      },
    })
  }

  // Forward real URL into the request so the dashboard layout + shell can match
  // the active tab to the same route as `children` on first paint (avoids a
  // one-frame wrong highlight / “wrong page” flash from usePathname during hydration).
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-sigo-pathname", pathname)

  const isMobileHint = parseViewportIsMobile(
    request.cookies.get(VIEWPORT_COOKIE)?.value,
    request.headers.get("sec-ch-ua-mobile"),
    request.headers.get("sec-ch-viewport-width")
  )
  if (isMobileHint === true) requestHeaders.set(VIEWPORT_MOBILE_HEADER, "1")
  if (isMobileHint === false) requestHeaders.set(VIEWPORT_MOBILE_HEADER, "0")

  const passHeaders = { request: { headers: requestHeaders } }

  // Receptionist invite links land on /onboarding?token=… — public (no session) so an invitee can
  // activate before they have an account. The page redirects token visits to the activation form.
  const hasInviteToken = Boolean(request.nextUrl.searchParams.get("token"))

  // The tech console requires a session, except its own public login page.
  const techNeedsSession = pathname.startsWith("/tech") && !pathname.startsWith("/tech/login")

  const needsSession =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/dev") ||
    (pathname.startsWith("/onboarding") && !hasInviteToken) ||
    pathname.startsWith("/receptionist") ||
    techNeedsSession
  if (!needsSession) {
    return withViewportHeaders(NextResponse.next(passHeaders), isMobileHint)
  }
  const raw =
    request.cookies.get(LYNCR_SESSION)?.value ||
    request.cookies.get(LEGACY_ZING_SESSION)?.value
  if (!raw || !raw.includes(".")) {
    const login = new URL("/login", request.url)
    login.searchParams.set("next", pathname)
    return withViewportHeaders(NextResponse.redirect(login), isMobileHint)
  }
  return withViewportHeaders(NextResponse.next(passHeaders), isMobileHint)
}

function withViewportHeaders(response: NextResponse, isMobileHint: boolean | null): NextResponse {
  response.headers.set("Accept-CH", "Sec-CH-UA-Mobile, Sec-CH-Viewport-Width")
  response.headers.append("Vary", "Sec-CH-UA-Mobile")
  if (isMobileHint === true || isMobileHint === false) {
    response.cookies.set(VIEWPORT_COOKIE, viewportCookieValue(isMobileHint), {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    })
  }
  return response
}

export const config = {
  matcher: [
    "/api/voice/telnyx/incoming",
    "/api/voice/incoming",
    "/dashboard",
    "/dashboard/:path*",
    "/admin",
    "/admin/:path*",
    "/dev",
    "/dev/:path*",
    "/onboarding",
    "/onboarding/:path*",
    "/receptionist",
    "/receptionist/:path*",
    "/tech",
    "/tech/:path*",
  ],
}
