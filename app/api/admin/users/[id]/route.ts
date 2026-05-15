// ============================================
// PATCH /api/admin/users/[id]
// ============================================
// Platform admin: update operator flags for another account.

import { NextRequest, NextResponse } from "next/server"
import { requirePlatformAdmin } from "@/lib/admin-api-guard"
import { adminSetUserPlatformAdminFlag } from "@/lib/db"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requirePlatformAdmin(req)
  if (ctx instanceof NextResponse) return ctx
  const { id: targetUserId } = await params
  try {
    const body = await req.json()
    if (typeof body?.is_platform_admin !== "boolean") {
      return NextResponse.json({ error: "Body must include is_platform_admin (boolean)" }, { status: 400 })
    }
    await adminSetUserPlatformAdminFlag(targetUserId, body.is_platform_admin)
    return NextResponse.json({ data: { ok: true, user_id: targetUserId, is_platform_admin: body.is_platform_admin } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Update failed"
    if (msg.includes("019-billing-admin-feedback")) {
      return NextResponse.json({ error: msg }, { status: 503 })
    }
    console.error("[Sigo] admin user PATCH:", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
