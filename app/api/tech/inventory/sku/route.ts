// GET /api/tech/inventory/sku?sku=KEY-VOL-05
// Resolve a barcode / typed SKU against the tech's OWNER's Key Inventory.

import { NextRequest, NextResponse } from "next/server"
import { resolveActor } from "@/lib/actor"
import { getFieldTechContext } from "@/lib/field-tech-auth"
import {
  getKeyInventoryBySku,
  normalizeInventorySku,
  serializeKeyInventoryForApi,
} from "@/lib/key-inventory"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const actor = await resolveActor(req.headers.get("cookie"), { capability: "inventory_control" })
  if (!actor || actor.actorRole !== "field_tech") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const sku = normalizeInventorySku(req.nextUrl.searchParams.get("sku") ?? "")
  if (!sku) return NextResponse.json({ error: "sku is required" }, { status: 400 })

  const ctx = await getFieldTechContext(actor.actingUserId)

  try {
    const row = await getKeyInventoryBySku(actor.ownerUserId, sku, ctx?.technician.organization_id ?? null)
    if (!row) {
      return NextResponse.json({
        data: { found: false as const, sku, item: null },
      })
    }
    return NextResponse.json({
      data: {
        found: true as const,
        sku: row.sku,
        item: serializeKeyInventoryForApi([row])[0],
      },
    })
  } catch (e) {
    console.error("[tech/inventory/sku]", e)
    return NextResponse.json({ error: "Inventory lookup failed" }, { status: 500 })
  }
}
