// ============================================
// PATCH /api/technicians/[id]   — toggle a tech active/inactive (owner-scoped)
// ============================================

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { setFieldTechnicianActive } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const { id } = await ctx.params
  const body = (await req.json().catch(() => ({}))) as { is_active?: boolean }
  if (typeof body.is_active !== "boolean") {
    return NextResponse.json({ error: "is_active (boolean) is required" }, { status: 400 })
  }

  try {
    await setFieldTechnicianActive(userId, id, body.is_active)
    return NextResponse.json({ data: { id, is_active: body.is_active } })
  } catch (e) {
    console.error("[PATCH /api/technicians/[id]] failed:", e)
    return NextResponse.json({ error: "Could not update technician" }, { status: 500 })
  }
}
