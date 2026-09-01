// GET /api/admin/notification-feed — unified admin header bell: pending shops + support (chat/email/feedback).

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { getAdminNotificationFeed } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx
  try {
    const feed = await getAdminNotificationFeed()
    return NextResponse.json({ data: feed })
  } catch (e) {
    console.error("[admin/notification-feed GET]", e)
    return NextResponse.json({ error: "Failed to load notifications" }, { status: 500 })
  }
}
