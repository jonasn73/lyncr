// ============================================
// PATCH  /api/technicians/[id] — toggle active or move tech to another workspace
// DELETE /api/technicians/[id] — remove tech from the owner roster
// ============================================

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { deleteFieldTechnicianForOwner, patchFieldTechnicianForOwner } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const { id } = await ctx.params
  const body = (await req.json().catch(() => ({}))) as {
    is_active?: boolean
    organization_id?: string | null
  }

  if (typeof body.is_active !== "boolean" && body.organization_id === undefined) {
    return NextResponse.json(
      { error: "Provide is_active (boolean) and/or organization_id" },
      { status: 400 }
    )
  }

  try {
    const ok = await patchFieldTechnicianForOwner(userId, id, {
      ...(typeof body.is_active === "boolean" ? { is_active: body.is_active } : {}),
      ...(body.organization_id !== undefined ? { organization_id: body.organization_id } : {}),
    })
    if (!ok) {
      return NextResponse.json({ error: "Technician not found or workspace invalid" }, { status: 404 })
    }
    return NextResponse.json({
      data: {
        id,
        ...(typeof body.is_active === "boolean" ? { is_active: body.is_active } : {}),
        ...(body.organization_id !== undefined ? { organization_id: body.organization_id } : {}),
      },
    })
  } catch (e) {
    console.error("[PATCH /api/technicians/[id]] failed:", e)
    return NextResponse.json({ error: "Could not update technician" }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = getUserIdFromRequest(_req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const { id } = await ctx.params
  try {
    const ok = await deleteFieldTechnicianForOwner(userId, id)
    if (!ok) {
      return NextResponse.json({ error: "Technician not found" }, { status: 404 })
    }
    return NextResponse.json({ data: { deleted: true, id } })
  } catch (e) {
    console.error("[DELETE /api/technicians/[id]] failed:", e)
    return NextResponse.json({ error: "Could not remove technician" }, { status: 500 })
  }
}
