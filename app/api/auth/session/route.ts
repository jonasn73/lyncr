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
  getLegacySessionCookieName,
  getSessionCookieOptions,
} from "@/lib/auth"
import { getUser, getUserAccountStatus, userFacingDatabaseError } from "@/lib/db"
import { globalPlatformSessionFields } from "@/lib/platform-admin"
import { resolveAdminNotificationPreferences } from "@/lib/admin-notification-preferences"
import {
  IMPERSONATION_ADMIN_COOKIE,
  IMPERSONATION_RETURN_COOKIE,
  verifyImpersonationAdminCookie,
} from "@/lib/admin-impersonation"

export async function GET(req: NextRequest) {
  try {
    // Prefer lyncr_session; still accept legacy zing_session until browsers refresh.
    const cookieStore = await cookies()
    let cookieValue =
      cookieStore.get(getSessionCookieName())?.value ||
      cookieStore.get(getLegacySessionCookieName())?.value
    if (!cookieValue && req.headers.get("cookie")) {
      const header = req.headers.get("cookie")!
      const lyncr = header.match(new RegExp(`${getSessionCookieName()}=([^;]+)`))
      const legacy = header.match(new RegExp(`${getLegacySessionCookieName()}=([^;]+)`))
      cookieValue = lyncr?.[1]?.trim() || legacy?.[1]?.trim()
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
      const devEmail = process.env.DEV_LOGIN_EMAIL?.trim().toLowerCase() ?? "dev@lyncr.local"
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
        answered_call_customer_popup_enabled: true,
        account_role: "owner" as const,
      }
      const devGlobal = globalPlatformSessionFields(devUser)
      const res = NextResponse.json({
        data: {
          user: {
            ...devUser,
            operator_access: devGlobal.isPlatformAdmin,
            ...devGlobal,
          },
        },
      })
      res.cookies.set(getSessionCookieName(), newCookieValue, opts)
      return res
    }
    const user = await getUser(userId)
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 401 })
    }

    const impersonationRaw = cookieStore.get(IMPERSONATION_ADMIN_COOKIE)?.value
    const impersonatingAdminId = verifyImpersonationAdminCookie(impersonationRaw)
    const returnRaw = cookieStore.get(IMPERSONATION_RETURN_COOKIE)?.value

    const globalFields = globalPlatformSessionFields(user)
    const accountStatus = await getUserAccountStatus(user.id)
    const {
      master_toggle_mode: _legacyToggle,
      admin_notification_preferences: _legacyPrefs,
      ...userPublic
    } = user
    const sessionUser = user.is_platform_admin
      ? {
          ...userPublic,
          is_platform_admin: true,
          admin_notification_preferences: resolveAdminNotificationPreferences(user),
          operator_access: globalFields.isPlatformAdmin,
          account_status: accountStatus,
          ...globalFields,
        }
      : {
          ...userPublic,
          operator_access: globalFields.isPlatformAdmin,
          account_status: accountStatus,
          ...globalFields,
        }
    const res = NextResponse.json({
      data: {
        user: sessionUser,
        impersonation: impersonatingAdminId
          ? {
              active: true,
              admin_user_id: impersonatingAdminId,
              return_to: returnRaw ? decodeURIComponent(returnRaw) : null,
            }
          : { active: false },
      },
    })
    res.cookies.set(getSessionCookieName(), newCookieValue, opts)
    return res
  } catch (error) {
    console.error("[lyncr] Session error:", error)
    const dbError = userFacingDatabaseError(error)
    if (dbError) {
      return NextResponse.json({ error: dbError }, { status: 503 })
    }
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    )
  }
}
