// ============================================
// Edge middleware — session cookie gate for /dashboard/*, /admin/*, and /onboarding
// ============================================
// Only checks that the session cookie exists (shape: payload.signature).
// Real signature + expiry validation stays in /api/auth/session (Node).
// This avoids a full-screen loading spinner and reduces “wrong page then correct page” flashes.

import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

/** Must match lib/auth.ts COOKIE_NAME */
const ZING_SESSION = "zing_session"

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Forward real URL into the request so the dashboard layout + shell can match
  // the active tab to the same route as `children` on first paint (avoids a
  // one-frame wrong highlight / “wrong page” flash from usePathname during hydration).
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-sigo-pathname", pathname)

  // Receptionist invite links land on /onboarding?token=… — public (no session) so an invitee can
  // activate before they have an account. The page redirects token visits to the activation form.
  const hasInviteToken = Boolean(request.nextUrl.searchParams.get("token"))

  // The tech console requires a session, except its own public login page.
  const techNeedsSession = pathname.startsWith("/tech") && !pathname.startsWith("/tech/login")

  const needsSession =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/admin") ||
    (pathname.startsWith("/onboarding") && !hasInviteToken) ||
    pathname.startsWith("/receptionist") ||
    techNeedsSession
  if (!needsSession) {
    return NextResponse.next({
      request: { headers: requestHeaders },
    })
  }
  const raw = request.cookies.get(ZING_SESSION)?.value
  if (!raw || !raw.includes(".")) {
    const login = new URL("/login", request.url)
    login.searchParams.set("next", pathname)
    return NextResponse.redirect(login)
  }
  return NextResponse.next({
    request: { headers: requestHeaders },
  })
}

export const config = {
  // Voice webhooks (/api/voice/*) are intentionally excluded — Telnyx needs raw TeXML with zero cookie/session work.
  matcher: ["/dashboard", "/dashboard/:path*", "/admin", "/admin/:path*", "/onboarding", "/onboarding/:path*", "/receptionist", "/receptionist/:path*", "/tech", "/tech/:path*"],
}
