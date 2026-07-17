// GET /api/inventory/sku?sku=KEY-VOL-05
// Resolve a barcode / typed SKU against the signed-in owner's Key Inventory.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  getKeyInventoryBySku,
  normalizeInventorySku,
  serializeKeyInventoryForApi,
} from "@/lib/key-inventory"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const sku = normalizeInventorySku(req.nextUrl.searchParams.get("sku") ?? "")
  if (!sku) return NextResponse.json({ error: "sku is required" }, { status: 400 })

  const organizationId = req.nextUrl.searchParams.get("organization_id")?.trim() || null

  try {
    const row = await getKeyInventoryBySku(userId, sku, organizationId)
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
    console.error("[inventory/sku]", e)
    return NextResponse.json({ error: "Inventory lookup failed" }, { status: 500 })
  }
}
