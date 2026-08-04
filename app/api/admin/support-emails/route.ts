// GET /api/admin/support-emails — list inbound support mail (admin@lyncr.app only).

import { NextRequest, NextResponse } from "next/server"
import { listAdminSupportEmails } from "@/lib/db"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx
  const limitRaw = req.nextUrl.searchParams.get("limit")
  const limit = limitRaw != null ? Number(limitRaw) : 50
  const items = await listAdminSupportEmails(Number.isFinite(limit) ? limit : 50)
  return NextResponse.json({ data: { items } })
}
