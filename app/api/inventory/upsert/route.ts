// PUT /api/inventory/upsert — call-time intake: set Van 1 quantity for a SKU (create or update).

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  normalizeInventorySku,
  serializeKeyInventoryForApi,
  upsertKeyInventoryVan1Stock,
} from "@/lib/key-inventory"

export async function PUT(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const sku = normalizeInventorySku(String(body.sku ?? ""))
  if (!sku) return NextResponse.json({ error: "sku is required" }, { status: 400 })

  const van1Raw = body.van1Quantity ?? body.van1_quantity ?? body.quantity
  const van1Quantity = Math.trunc(Number(van1Raw))
  if (!Number.isFinite(van1Quantity) || van1Quantity < 0) {
    return NextResponse.json({ error: "van1Quantity must be a non-negative integer" }, { status: 400 })
  }

  try {
    const { row, created } = await upsertKeyInventoryVan1Stock({
      userId,
      organizationId: body.organization_id != null ? String(body.organization_id) : null,
      sku,
      fccId: body.fccId != null ? String(body.fccId) : body.fcc_id != null ? String(body.fcc_id) : "",
      brand: body.brand != null ? String(body.brand) : "",
      van1Quantity,
      year: body.year != null ? String(body.year) : null,
      make: body.make != null ? String(body.make) : null,
      model: body.model != null ? String(body.model) : null,
    })

    return NextResponse.json({
      data: {
        created,
        item: serializeKeyInventoryForApi([row])[0],
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not upsert inventory"
    console.error("[inventory/upsert]", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
