// ============================================
// GET /api/auth/session
// ============================================
// Returns the current user from the session cookie, or 401.
// Refreshes the session cookie (sliding expiration) so you stay logged in while using the app.

import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import {
  verifySessionCookie,
  createSessionCookie,
  getSessionCookieName,
  getSessionCookieOptions,
} from "@/lib/auth"
import { getUser } from "@/lib/db"
import { isPlatformAdminUser } from "@/lib/platform-admin"

export async function GET(req: NextRequest) {
  try {
    // Read session cookie (try both methods so it works across refresh / different Next.js contexts)
    const cookieStore = await cookies()
    let cookieValue = cookieStore.get("zing_session")?.value
    if (!cookieValue && req.headers.get("cookie")) {
      const match = req.headers.get("cookie")!.match(/zing_session=([^;]+)/)
      cookieValue = match?.[1]?.trim()
    }
    const userId = verifySessionCookie(cookieValue)
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }
    // Refresh cookie so session stays valid while you use the app (sliding expiration)
    const newCookieValue = createSessionCookie(userId)
    const opts = getSessionCookieOptions()

    // Dev bypass: no DB call for dev-user (used when database is not connected)
    if (process.env.NODE_ENV === "development" && userId === "dev-user") {
      const devEmail = process.env.DEV_LOGIN_EMAIL?.trim().toLowerCase() ?? "dev@zing.local"
      const devUser = {
        id: "dev-user",
        email: devEmail,
        name: "Dev User",
        phone: "+15551234567",
        business_name: "My Business",
        inbound_receptionist_whisper_enabled: true,
        industry: "generic",
        telnyx_ai_assistant_id: null,
        created_at: new Date().toISOString(),
        credit_balance_cents: 0,
        billing_plan: "trial",
        is_platform_admin: false,
      }
      const res = NextResponse.json({
        data: {
          user: { ...devUser, operator_access: isPlatformAdminUser(devUser) },
        },
      })
      res.cookies.set(getSessionCookieName(), newCookieValue, opts)
      return res
    }
    const user = await getUser(userId)
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 401 })
    }
    const res = NextResponse.json({
      data: { user: { ...user, operator_access: isPlatformAdminUser(user) } },
    })
    res.cookies.set(getSessionCookieName(), newCookieValue, opts)
    return res
  } catch (error) {
    console.error("[Sigo] Session error:", error)
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    )
  }
}
