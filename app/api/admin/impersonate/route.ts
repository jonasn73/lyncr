// POST /api/admin/impersonate — start viewing the app as a target user (admin@lyncr.app only).

import { NextRequest, NextResponse } from "next/server"
import {
  createSessionCookie,
  getSessionCookieName,
  getSessionCookieOptions,
} from "@/lib/auth"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import {
  createImpersonationAdminCookie,
  getImpersonationAdminCookieOptions,
  IMPERSONATION_ADMIN_COOKIE,
} from "@/lib/admin-impersonation"
import { getUser } from "@/lib/db"
import { isLyncrAdminUser } from "@/lib/lyncr-admin"
import { recordAuditEvent } from "@/lib/audit-log"

export async function POST(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  try {
    const body = (await req.json()) as Record<string, unknown>
    const targetUserId = String(body.targetUserId ?? body.target_user_id ?? body.userId ?? "").trim()

    if (!targetUserId) {
      return NextResponse.json({ error: "targetUserId is required" }, { status: 400 })
    }
    if (targetUserId === ctx.userId) {
      return NextResponse.json({ error: "Cannot impersonate your own account" }, { status: 400 })
    }

    const target = await getUser(targetUserId)
    if (!target) {
      return NextResponse.json({ error: "Target user not found" }, { status: 404 })
    }
    if (isLyncrAdminUser(target)) {
      return NextResponse.json({ error: "Cannot impersonate another operator account" }, { status: 403 })
    }

    const res = NextResponse.json({
      data: {
        redirect: "/dashboard",
        impersonating: true,
        target_user_id: targetUserId,
        target_email: target.email,
      },
    })

    res.cookies.set(getSessionCookieName(), createSessionCookie(targetUserId), getSessionCookieOptions())
    res.cookies.set(
      IMPERSONATION_ADMIN_COOKIE,
      createImpersonationAdminCookie(ctx.userId),
      getImpersonationAdminCookieOptions()
    )

    void recordAuditEvent({
      ownerUserId: targetUserId,
      actorUserId: ctx.userId,
      actorRole: "platform_admin",
      eventType: "admin.impersonate_start",
      entityType: "user",
      entityId: targetUserId,
      detail: { target_email: target.email },
    })

    return res
  } catch (e) {
    console.error("[lyncr-admin] impersonate:", e)
    return NextResponse.json({ error: "Failed to start impersonation" }, { status: 500 })
  }
}
