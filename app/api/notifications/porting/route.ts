// ============================================
// GET/PATCH /api/notifications/porting
// ============================================
// In-app list of Telnyx porting/carrier updates (from /api/webhooks/telnyx/porting).

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  listPortingNotifications,
  countUnreadPortingNotifications,
  markPortingNotificationsRead,
  markAllPortingNotificationsRead,
} from "@/lib/db"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  const { searchParams } = new URL(req.url)
  const unreadOnly = searchParams.get("unread") === "1"
  try {
    const [notifications, unreadCount] = await Promise.all([
      listPortingNotifications(userId, 50),
      countUnreadPortingNotifications(userId),
    ])
    const data = unreadOnly ? notifications.filter((n) => n.read_at == null) : notifications
    return NextResponse.json({ data: { notifications: data, unreadCount } })
  } catch (e) {
    console.error("[Sigo] GET /api/notifications/porting:", e)
    return NextResponse.json({ error: "Failed to load notifications" }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  try {
    const body = (await req.json()) as { ids?: string[]; markAllRead?: boolean }
    if (body.markAllRead) {
      await markAllPortingNotificationsRead(userId)
      return NextResponse.json({ data: { ok: true } })
    }
    const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === "string") : []
    await markPortingNotificationsRead(userId, ids)
    return NextResponse.json({ data: { ok: true } })
  } catch (e) {
    console.error("[Sigo] PATCH /api/notifications/porting:", e)
    return NextResponse.json({ error: "Failed to update" }, { status: 500 })
  }
}
