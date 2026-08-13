// GET /api/admin/support-pulse — unread chat + email + open feedback for the Support badge.

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { getAdminSupportPulse } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx
  try {
    const pulse = await getAdminSupportPulse()
    return NextResponse.json({ data: pulse })
  } catch (e) {
    console.error("[admin/support-pulse GET]", e)
    return NextResponse.json({ error: "Failed to load support pulse" }, { status: 500 })
  }
}
