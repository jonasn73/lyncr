// PATCH /api/receptionist/endpoint — set the signed-in receptionist's live-call endpoint.
// Body: { endpoint: "WEB" | "CELL" }. WEB = ring the browser via Telnyx WebRTC; CELL = forward to cell.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getReceptionistPortalContext } from "@/lib/receptionist-portal-auth"
import { updateReceptionist } from "@/lib/db"

export async function PATCH(req: NextRequest) {
  // Identify the logged-in user from the session cookie (same pattern as the dashboard route).
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  // Read + validate the requested endpoint value.
  let body: { endpoint?: unknown }
  try {
    body = (await req.json()) as { endpoint?: unknown }
  } catch {
    body = {}
  }
  const endpoint = String(body.endpoint ?? "").toUpperCase()
  if (endpoint !== "WEB" && endpoint !== "CELL") {
    return NextResponse.json({ error: "endpoint must be 'WEB' or 'CELL'" }, { status: 400 })
  }

  try {
    // Resolve which receptionist row this portal account maps to.
    const ctx = await getReceptionistPortalContext(userId)
    if (!ctx) {
      return NextResponse.json({ error: "Receptionist portal access required" }, { status: 403 })
    }

    // receptionists.user_id is the OWNER account; updateReceptionist scopes by (id, owner user_id),
    // clears the routing cache, and resyncs the inbound snapshot so calls pick this up immediately.
    await updateReceptionist(ctx.receptionist.id, ctx.receptionist.user_id, {
      routing_endpoint: endpoint as "WEB" | "CELL",
    })

    return NextResponse.json({ data: { routing_endpoint: endpoint } })
  } catch (error) {
    console.error("[lyncr] set receptionist endpoint:", error)
    return NextResponse.json({ error: "Failed to update endpoint" }, { status: 500 })
  }
}
