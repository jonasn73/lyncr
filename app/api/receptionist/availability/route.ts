// PATCH /api/receptionist/availability — Available / Unavailable for the signed-in receptionist.
// Body: { is_available: boolean }. Maps to receptionists.is_active.
// Unavailable → inbound snapshot clears this receptionist so calls use the owner's fallback.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getReceptionistPortalContext } from "@/lib/receptionist-portal-auth"
import { updateReceptionist } from "@/lib/db"

export async function PATCH(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  let body: { is_available?: unknown }
  try {
    body = (await req.json()) as { is_available?: unknown }
  } catch {
    body = {}
  }
  if (typeof body.is_available !== "boolean") {
    return NextResponse.json({ error: "is_available must be true or false" }, { status: 400 })
  }

  try {
    const ctx = await getReceptionistPortalContext(userId)
    if (!ctx) {
      return NextResponse.json({ error: "Receptionist portal access required" }, { status: 403 })
    }

    // is_active drives both the portal toggle and inbound dial (see syncInboundDialSnapshotForNumber).
    await updateReceptionist(ctx.receptionist.id, ctx.receptionist.user_id, {
      is_active: body.is_available,
    })

    return NextResponse.json({ data: { is_available: body.is_available, is_active: body.is_available } })
  } catch (error) {
    console.error("[lyncr] set receptionist availability:", error)
    return NextResponse.json({ error: "Failed to update availability" }, { status: 500 })
  }
}
