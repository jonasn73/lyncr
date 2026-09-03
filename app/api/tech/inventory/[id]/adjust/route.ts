// PATCH /api/tech/inventory/[id]/adjust — { delta: 1 | -1, location?: "van1"|"van2"|"shop" }
// Same as /api/inventory/[id]/adjust, scoped to the tech's owner. adjustKeyInventoryQuantity
// filters its UPDATE by user_id, so passing the owner's id is what keeps a tech from touching
// another business's stock — not an extra check bolted on here.

import { NextRequest, NextResponse } from "next/server"
import { resolveActor } from "@/lib/actor"
import { getFieldTechContext } from "@/lib/field-tech-auth"
import {
  adjustKeyInventoryQuantity,
  serializeKeyInventoryForApi,
  type KeyInventoryStockLocation,
} from "@/lib/key-inventory"

export const dynamic = "force-dynamic"

const LOCATIONS = new Set<KeyInventoryStockLocation>(["van1", "van2", "shop"])

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const actor = await resolveActor(req.headers.get("cookie"), { capability: "inventory_control" })
  if (!actor || actor.actorRole !== "field_tech") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await ctx.params
  if (!id?.trim()) return NextResponse.json({ error: "id is required" }, { status: 400 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const delta = Math.trunc(Number(body.delta))
  if (!Number.isFinite(delta) || delta === 0) {
    return NextResponse.json({ error: "delta must be a non-zero integer" }, { status: 400 })
  }

  const locationRaw = String(body.location ?? "van1") as KeyInventoryStockLocation
  const location = LOCATIONS.has(locationRaw) ? locationRaw : "van1"
  // Set when logging a key used on a specific job — deduct + ledger reason both key off this.
  const jobId = typeof body.jobId === "string" && body.jobId.trim() ? body.jobId.trim() : null

  try {
    const ctx = await getFieldTechContext(actor.actingUserId)
    const row = await adjustKeyInventoryQuantity({
      userId: actor.ownerUserId,
      id: id.trim(),
      delta,
      location,
      jobId,
      actor: {
        role: "field_tech",
        userId: actor.actingUserId,
        label: ctx?.technician.name?.trim() || "Technician",
      },
    })
    if (!row) {
      return NextResponse.json({ error: "Inventory item not found" }, { status: 404 })
    }
    return NextResponse.json({
      data: { item: serializeKeyInventoryForApi([row])[0] },
    })
  } catch (e) {
    console.error("[tech/inventory/adjust]", e)
    return NextResponse.json({ error: "Could not update stock" }, { status: 500 })
  }
}
