// POST /api/admin/toggle-subscription — admin@lyncr.app only; set subscription + tier.

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { adminToggleUserSubscription } from "@/lib/db"
import { recordAuditEvent } from "@/lib/audit-log"

export async function POST(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  try {
    const body = (await req.json()) as Record<string, unknown>
    const userId = String(body.userId ?? body.user_id ?? "").trim()
    const shouldActivate =
      typeof body.shouldActivate === "boolean"
        ? body.shouldActivate
        : typeof body.activeStatus === "boolean"
          ? body.activeStatus
          : null

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 })
    }
    if (shouldActivate === null) {
      return NextResponse.json({ error: "shouldActivate must be a boolean" }, { status: 400 })
    }

    const result = await adminToggleUserSubscription(userId, shouldActivate)
    void recordAuditEvent({
      ownerUserId: userId,
      actorUserId: ctx.userId,
      actorRole: "platform_admin",
      eventType: "admin.subscription_toggled",
      entityType: "user",
      entityId: userId,
      detail: { active: shouldActivate },
    })
    return NextResponse.json({
      success: true,
      data: result,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Subscription toggle failed"
    console.error("[lyncr-admin] toggle-subscription:", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
