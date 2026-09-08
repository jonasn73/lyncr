// GET /api/admin/audit — paginated platform audit feed (admin only).
// Optional ?owner_user_id=, ?event_type=, ?entity_id=, ?before= (ISO timestamp cursor), ?limit=.

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { listAuditEvents } from "@/lib/db"

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx
  try {
    const ownerUserId = req.nextUrl.searchParams.get("owner_user_id")?.trim() || null
    const eventType = req.nextUrl.searchParams.get("event_type")?.trim() || null
    const entityId = req.nextUrl.searchParams.get("entity_id")?.trim() || null
    const before = req.nextUrl.searchParams.get("before")?.trim() || null
    const limitRaw = parseInt(req.nextUrl.searchParams.get("limit") ?? "", 10)
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 100

    const events = await listAuditEvents({
      ownerUserId,
      eventType,
      entityId,
      limit,
      beforeCreatedAt: before,
    })
    return NextResponse.json({ data: { events } })
  } catch (e) {
    console.error("[lyncr-admin] audit:", e)
    return NextResponse.json({ error: "Failed to load audit events" }, { status: 500 })
  }
}
