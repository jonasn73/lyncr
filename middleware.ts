// ============================================
// Edge middleware — session cookie gate for /dashboard/* and /admin/*
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
  requestHeaders.set("x-zing-pathname", pathname)

  const needsSession = pathname.startsWith("/dashboard") || pathname.startsWith("/admin")
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
  matcher: ["/dashboard", "/dashboard/:path*", "/admin", "/admin/:path*"],
}
