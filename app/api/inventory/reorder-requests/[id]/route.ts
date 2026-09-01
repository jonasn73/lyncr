// PATCH /api/inventory/reorder-requests/[id] — owner acts on one request.
// Body: { action: "approve" | "deny" | "mark_ordered" | "receive" | "cancel", ... }
//   deny:    { reason?: string }
//   receive: { location?: "van1" | "van2" | "shop" }

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUser } from "@/lib/db"
import type { KeyInventoryStockLocation } from "@/lib/key-inventory"
import {
  cancelReorderRequest,
  decideReorderRequest,
  markReorderRequestOrdered,
  receiveReorderRequest,
} from "@/lib/key-reorder-requests"

export const dynamic = "force-dynamic"

const LOCATIONS = new Set<KeyInventoryStockLocation>(["van1", "van2", "shop"])

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const { id } = await ctx.params
  if (!id?.trim()) return NextResponse.json({ error: "id is required" }, { status: 400 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const action = String(body.action ?? "").trim()

  try {
    if (action === "approve" || action === "deny") {
      const request = await decideReorderRequest({
        ownerUserId: userId,
        requestId: id.trim(),
        decision: action === "approve" ? "approved" : "denied",
        decidedByUserId: userId,
        denialReason: body.reason != null ? String(body.reason) : null,
      })
      if (!request) return NextResponse.json({ error: "Request not found or already decided" }, { status: 404 })
      return NextResponse.json({ data: { request } })
    }

    if (action === "mark_ordered") {
      const request = await markReorderRequestOrdered({ ownerUserId: userId, requestId: id.trim() })
      if (!request) return NextResponse.json({ error: "Request not found or not approved" }, { status: 404 })
      return NextResponse.json({ data: { request } })
    }

    if (action === "receive") {
      const locationRaw = String(body.location ?? "shop") as KeyInventoryStockLocation
      const location = LOCATIONS.has(locationRaw) ? locationRaw : "shop"
      const owner = await getUser(userId)
      const request = await receiveReorderRequest({
        ownerUserId: userId,
        requestId: id.trim(),
        location,
        actor: { role: "owner", userId, label: owner?.business_name?.trim() || owner?.name?.trim() || "Owner" },
      })
      if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 })
      return NextResponse.json({ data: { request } })
    }

    if (action === "cancel") {
      const request = await cancelReorderRequest({ ownerUserId: userId, requestId: id.trim() })
      if (!request) return NextResponse.json({ error: "Request not found or already finished" }, { status: 404 })
      return NextResponse.json({ data: { request } })
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not update reorder request"
    console.error("[inventory/reorder-requests PATCH]", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
