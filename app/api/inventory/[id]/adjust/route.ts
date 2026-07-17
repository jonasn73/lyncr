// PATCH /api/inventory/[id]/adjust — { delta: 1 | -1, location?: "van1"|"van2"|"shop" }

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  adjustKeyInventoryQuantity,
  serializeKeyInventoryForApi,
  type KeyInventoryStockLocation,
} from "@/lib/key-inventory"

const LOCATIONS = new Set<KeyInventoryStockLocation>(["van1", "van2", "shop"])

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
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

  const delta = Math.trunc(Number(body.delta))
  if (!Number.isFinite(delta) || delta === 0) {
    return NextResponse.json({ error: "delta must be a non-zero integer" }, { status: 400 })
  }

  const locationRaw = String(body.location ?? "van1") as KeyInventoryStockLocation
  const location = LOCATIONS.has(locationRaw) ? locationRaw : "van1"

  try {
    const row = await adjustKeyInventoryQuantity({
      userId,
      id: id.trim(),
      delta,
      location,
    })
    if (!row) {
      return NextResponse.json({ error: "Inventory item not found" }, { status: 404 })
    }
    return NextResponse.json({
      data: { item: serializeKeyInventoryForApi([row])[0] },
    })
  } catch (e) {
    console.error("[inventory/adjust]", e)
    return NextResponse.json({ error: "Could not update stock" }, { status: 500 })
  }
}
