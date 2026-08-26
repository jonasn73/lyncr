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

    // Going on duty starts the clock; going off stops it and pays the hours. Both are
    // idempotent, so a double-tapped toggle cannot open two shifts or pay one twice.
    // Availability is the user-facing action — never fail it over a timesheet write.
    try {
      const { openShift, closeShift } = await import("@/lib/compensation/shifts")
      const ref = { role: "receptionist" as const, receptionist_id: ctx.receptionist.id }
      if (body.is_available) {
        await openShift({
          ownerUserId: ctx.receptionist.user_id,
          ref,
          workerUserId: userId,
        })
      } else {
        await closeShift({ ref })
      }
    } catch (e) {
      console.error("[lyncr] shift clock on availability change:", e)
    }

    return NextResponse.json({ data: { is_available: body.is_available, is_active: body.is_available } })
  } catch (error) {
    console.error("[lyncr] set receptionist availability:", error)
    return NextResponse.json({ error: "Failed to update availability" }, { status: 500 })
  }
}
