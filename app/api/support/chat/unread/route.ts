// GET /api/support/chat/unread — tenant unread badge count

import { NextRequest, NextResponse } from "next/server"
import { requireSessionUser } from "@/lib/admin-api-guard"
import { getSupportChatUserUnreadCount } from "@/lib/db"

export async function GET(req: NextRequest) {
  const ctx = await requireSessionUser(req)
  if (ctx instanceof NextResponse) return ctx

  try {
    const count = await getSupportChatUserUnreadCount(ctx.userId)
    return NextResponse.json({ data: { unread_count: count } })
  } catch (e) {
    console.error("[support/chat/unread]", e)
    return NextResponse.json({ data: { unread_count: 0 } })
  }
}
