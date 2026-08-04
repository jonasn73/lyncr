// GET /api/admin/support-chat — list conversation threads

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { listSupportChatThreadsForAdmin } from "@/lib/db"

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  try {
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? "50")
    const items = await listSupportChatThreadsForAdmin(limit)
    return NextResponse.json({ data: { items } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load threads"
    if (msg.includes("128-support-chat")) {
      return NextResponse.json({ error: msg }, { status: 503 })
    }
    console.error("[admin/support-chat GET]", e)
    return NextResponse.json({ error: "Failed to load threads" }, { status: 500 })
  }
}
