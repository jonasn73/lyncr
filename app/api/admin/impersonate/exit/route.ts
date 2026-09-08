// POST /api/admin/impersonate/exit — restore operator session after impersonation.

import { NextRequest, NextResponse } from "next/server"
import {
  createSessionCookie,
  getSessionCookieName,
  getSessionCookieOptions,
  getUserIdFromRequest,
} from "@/lib/auth"
import {
  getImpersonationAdminCookieClearOptions,
  IMPERSONATION_ADMIN_COOKIE,
  IMPERSONATION_RETURN_COOKIE,
  normalizeImpersonationReturnPath,
  verifyImpersonationAdminCookie,
  getImpersonationReturnCookieClearOptions,
} from "@/lib/admin-impersonation"
import { getUser } from "@/lib/db"
import { isLyncrAdminUser } from "@/lib/lyncr-admin"
import { recordAuditEvent } from "@/lib/audit-log"

export async function POST(req: NextRequest) {
  try {
    const match = req.headers.get("cookie")?.match(new RegExp(`${IMPERSONATION_ADMIN_COOKIE}=([^;]+)`))
    const adminUserId = verifyImpersonationAdminCookie(match?.[1]?.trim())
    if (!adminUserId) {
      return NextResponse.json({ error: "Not impersonating" }, { status: 400 })
    }

    const admin = await getUser(adminUserId)
    if (!admin || !isLyncrAdminUser(admin)) {
      return NextResponse.json({ error: "Invalid impersonation session" }, { status: 403 })
    }

    // Still the impersonated target's session at this point — the account being viewed.
    const impersonatedUserId = getUserIdFromRequest(req.headers.get("cookie"))

    const returnRaw = req.headers.get("cookie")?.match(new RegExp(`${IMPERSONATION_RETURN_COOKIE}=([^;]+)`))?.[1]
    const returnTo =
      normalizeImpersonationReturnPath(returnRaw ? decodeURIComponent(returnRaw.trim()) : null) ?? "/admin"

    const res = NextResponse.json({ data: { redirect: returnTo } })
    res.cookies.set(getSessionCookieName(), createSessionCookie(adminUserId), getSessionCookieOptions())
    res.cookies.set(IMPERSONATION_ADMIN_COOKIE, "", getImpersonationAdminCookieClearOptions())
    res.cookies.set(IMPERSONATION_RETURN_COOKIE, "", getImpersonationReturnCookieClearOptions())

    void recordAuditEvent({
      ownerUserId: impersonatedUserId ?? null,
      actorUserId: adminUserId,
      actorRole: "platform_admin",
      eventType: "admin.impersonate_stop",
      entityType: "user",
      entityId: impersonatedUserId ?? undefined,
    })

    return res
  } catch (e) {
    console.error("[lyncr-admin] impersonate exit:", e)
    return NextResponse.json({ error: "Failed to exit impersonation" }, { status: 500 })
  }
}
