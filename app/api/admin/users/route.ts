// ============================================
// GET /api/admin/users
// ============================================
// Paginated-style list of accounts (fixed limit for now).

import { NextRequest, NextResponse } from "next/server"
import { listAdminUserSummaries } from "@/lib/db"
import { requirePlatformAdmin } from "@/lib/admin-api-guard"

export async function GET(req: NextRequest) {
  const ctx = await requirePlatformAdmin(req)
  if (ctx instanceof NextResponse) return ctx
  const limitRaw = req.nextUrl.searchParams.get("limit")
  const limit = limitRaw != null ? Number(limitRaw) : 200
  try {
    const users = await listAdminUserSummaries(Number.isFinite(limit) ? limit : 200)
    return NextResponse.json({ data: { users } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to list users"
    if (msg.includes("019-billing-admin-feedback")) {
      return NextResponse.json({ error: msg }, { status: 503 })
    }
    console.error("[Sigo] admin users:", e)
    return NextResponse.json({ error: "Failed to list users" }, { status: 500 })
  }
}
