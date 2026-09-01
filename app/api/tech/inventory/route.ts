// POST /api/tech/inventory — register a new Key Inventory SKU under the tech's owner.

import { NextRequest, NextResponse } from "next/server"
import { resolveActor } from "@/lib/actor"
import { getFieldTechContext } from "@/lib/field-tech-auth"
import {
  createKeyInventoryItem,
  normalizeInventorySku,
  serializeKeyInventoryForApi,
} from "@/lib/key-inventory"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const actor = await resolveActor(req.headers.get("cookie"), { capability: "inventory_control" })
  if (!actor || actor.actorRole !== "field_tech") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const sku = normalizeInventorySku(String(body.sku ?? ""))
  if (!sku) return NextResponse.json({ error: "sku is required" }, { status: 400 })

  const ctx = await getFieldTechContext(actor.actingUserId)

  try {
    const { row, created } = await createKeyInventoryItem({
      userId: actor.ownerUserId,
      organizationId: ctx?.technician.organization_id ?? null,
      sku,
      fccId: body.fccId != null ? String(body.fccId) : body.fcc_id != null ? String(body.fcc_id) : "",
      brand: body.brand != null ? String(body.brand) : "",
      van1Quantity: body.van1Quantity != null ? Number(body.van1Quantity) : 1,
      van2Quantity: body.van2Quantity != null ? Number(body.van2Quantity) : 0,
      shopQuantity: body.shopQuantity != null ? Number(body.shopQuantity) : 0,
      minimumStockAlert:
        body.minimumStockAlert != null ? Number(body.minimumStockAlert) : 1,
      notes: body.notes != null ? String(body.notes) : null,
    })

    return NextResponse.json(
      {
        data: {
          created,
          item: serializeKeyInventoryForApi([row])[0],
        },
      },
      { status: created ? 201 : 200 }
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not create inventory item"
    console.error("[tech/inventory POST]", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
