// DELETE /api/owner/scheduler/blockouts/[id] — reopen blocked slots.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { deleteScheduleBlockout } from "@/lib/schedule-blockouts-db"

export const dynamic = "force-dynamic"

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const { id } = await context.params
  const blockoutId = (id || "").trim()
  if (!blockoutId) {
    return NextResponse.json({ error: "Missing blockout id" }, { status: 400 })
  }

  try {
    const ok = await deleteScheduleBlockout({ ownerUserId: userId, blockoutId })
    if (!ok) return NextResponse.json({ error: "Blockout not found" }, { status: 404 })
    return NextResponse.json({ data: { deleted: true, id: blockoutId } })
  } catch (e) {
    console.error("[DELETE /api/owner/scheduler/blockouts/:id]", e)
    return NextResponse.json({ error: "Delete failed" }, { status: 500 })
  }
}
