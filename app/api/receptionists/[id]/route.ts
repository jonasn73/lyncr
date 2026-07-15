// ============================================
// PATCH /api/receptionists/[id]
// DELETE /api/receptionists/[id]
// ============================================
// Update or delete a receptionist. Protected: requires session.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { updateReceptionist, deleteReceptionist, getReceptionist } from "@/lib/db"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  const { id } = await params
  const existing = await getReceptionist(id)
  if (!existing || existing.user_id !== userId) {
    return NextResponse.json({ error: "Receptionist not found" }, { status: 404 })
  }
  try {
    const body = await req.json()
    const updates: Partial<{
      name: string
      phone: string
      is_active: boolean
      rate_per_minute: number
      pay_mode: "FLAT_RATE" | "PER_MINUTE"
      flat_rate_usd: number
    }> = {}
    if (typeof body?.name === "string") updates.name = body.name.trim()
    if (typeof body?.phone === "string") updates.phone = body.phone.trim()
    if (typeof body?.is_active === "boolean") updates.is_active = body.is_active
    if (typeof body?.rate_per_minute === "number") updates.rate_per_minute = body.rate_per_minute
    if (body?.pay_mode === "FLAT_RATE" || body?.pay_mode === "PER_MINUTE") updates.pay_mode = body.pay_mode
    if (typeof body?.flat_rate_usd === "number") updates.flat_rate_usd = body.flat_rate_usd
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ data: existing })
    }
    await updateReceptionist(id, userId, updates)
    const updated = await getReceptionist(id)
    return NextResponse.json({ data: updated })
  } catch (error) {
    console.error("[lyncr] Update receptionist error:", error)
    return NextResponse.json(
      { error: "Failed to update receptionist" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = getUserIdFromRequest(_req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  const { id } = await params
  const existing = await getReceptionist(id)
  if (!existing || existing.user_id !== userId) {
    return NextResponse.json({ error: "Receptionist not found" }, { status: 404 })
  }
  try {
    await deleteReceptionist(id, userId)
    return NextResponse.json({ data: { ok: true } })
  } catch (error) {
    console.error("[lyncr] Delete receptionist error:", error)
    return NextResponse.json(
      { error: "Failed to remove receptionist" },
      { status: 500 }
    )
  }
}
