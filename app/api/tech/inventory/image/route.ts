// POST /api/tech/inventory/image — Quick Photo Upload for Key Inventory, scoped to the
// tech's owner. Same shape as /api/inventory/image; see that file for the parsing comments.

import { NextRequest, NextResponse } from "next/server"
import { resolveActor } from "@/lib/actor"
import { getFieldTechContext } from "@/lib/field-tech-auth"
import {
  getKeyInventoryBySku,
  normalizeInventorySku,
  serializeKeyInventoryForApi,
  updateKeyInventoryImage,
  upsertKeyInventoryVan1Stock,
} from "@/lib/key-inventory"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_BYTES = 2_500_000

async function readImageFromRequest(req: NextRequest): Promise<{
  mimeType: string
  dataBase64: string
  id: string | null
  sku: string | null
  fccId: string
  frequency: string
  year: string | null
  make: string | null
  model: string | null
}> {
  const contentType = req.headers.get("content-type") || ""

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData()
    const file = form.get("file")
    if (!file || !(file instanceof File)) {
      throw new Error("Missing file field")
    }
    if (file.size > MAX_BYTES) throw new Error("Image too large (max ~2.5MB)")
    const buf = Buffer.from(await file.arrayBuffer())
    return {
      mimeType: file.type || "image/jpeg",
      dataBase64: buf.toString("base64"),
      id: form.get("id") != null ? String(form.get("id")).trim() : null,
      sku: form.get("sku") != null ? String(form.get("sku")).trim() : null,
      fccId: form.get("fccId") != null ? String(form.get("fccId")) : "",
      frequency: form.get("frequency") != null ? String(form.get("frequency")) : "",
      year: form.get("year") != null ? String(form.get("year")) : null,
      make: form.get("make") != null ? String(form.get("make")) : null,
      model: form.get("model") != null ? String(form.get("model")) : null,
    }
  }

  const body = (await req.json()) as Record<string, unknown>
  const dataBase64 = String(body.data_base64 ?? body.dataBase64 ?? "").trim()
  if (!dataBase64) throw new Error("data_base64 is required")
  return {
    mimeType: String(body.mime_type ?? body.mimeType ?? "image/jpeg"),
    dataBase64,
    id: body.id != null ? String(body.id).trim() : null,
    sku: body.sku != null ? String(body.sku).trim() : null,
    fccId: body.fccId != null ? String(body.fccId) : body.fcc_id != null ? String(body.fcc_id) : "",
    frequency: body.frequency != null ? String(body.frequency) : "",
    year: body.year != null ? String(body.year) : null,
    make: body.make != null ? String(body.make) : null,
    model: body.model != null ? String(body.model) : null,
  }
}

export async function POST(req: NextRequest) {
  const actor = await resolveActor(req.headers.get("cookie"), { capability: "inventory_control" })
  if (!actor || actor.actorRole !== "field_tech") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    const payload = await readImageFromRequest(req)
    let inventoryId = payload.id?.trim() || null
    const ctx = await getFieldTechContext(actor.actingUserId)
    const organizationId = ctx?.technician.organization_id ?? null

    if (!inventoryId) {
      const sku = normalizeInventorySku(payload.sku || "")
      if (!sku) {
        return NextResponse.json(
          { error: "id or sku is required to attach a key photo" },
          { status: 400 }
        )
      }
      const existing = await getKeyInventoryBySku(actor.ownerUserId, sku, organizationId)
      if (existing) {
        inventoryId = existing.id
      } else {
        const created = await upsertKeyInventoryVan1Stock({
          userId: actor.ownerUserId,
          organizationId,
          sku,
          fccId: payload.fccId,
          frequency: payload.frequency,
          tiSku: sku,
          van1Quantity: 0,
          year: payload.year,
          make: payload.make,
          model: payload.model,
        })
        inventoryId = created.row.id
      }
    }

    const row = await updateKeyInventoryImage({
      userId: actor.ownerUserId,
      id: inventoryId,
      mimeType: payload.mimeType,
      dataBase64: payload.dataBase64,
    })
    if (!row) {
      return NextResponse.json({ error: "Inventory item not found" }, { status: 404 })
    }

    return NextResponse.json({
      data: {
        item: serializeKeyInventoryForApi([row])[0],
        // The stored row.imageUrl points at the owner-only serve route (see keyInventoryImagePath
        // in lib/key-inventory.ts) — the tech client must build its own /api/tech/... URL instead.
        imageUrl: row.imageUrl,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Upload failed"
    console.error("[tech/inventory/image POST]", e)
    const status = /too large/i.test(msg) ? 413 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
