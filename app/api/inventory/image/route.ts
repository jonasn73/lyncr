// POST /api/inventory/image — Quick Photo Upload for Key Inventory (multipart or JSON base64).

import { NextRequest, NextResponse } from "next/server" // Next.js request/response helpers
import { getUserIdFromRequest } from "@/lib/auth" // Read signed-in user from cookie
import {
  getKeyInventoryBySku, // Find existing inventory row by SKU
  normalizeInventorySku, // Clean SKU string
  serializeKeyInventoryForApi, // Shape DB row for the client
  updateKeyInventoryImage, // Save photo bytes + image_url
  upsertKeyInventoryVan1Stock, // Create a row if SKU is new
} from "@/lib/key-inventory"

export const runtime = "nodejs" // Need Node Buffer for image bytes
export const dynamic = "force-dynamic" // Always run on the server (no static cache)

const MAX_BYTES = 2_500_000 // Reject huge uploads (~2.5MB)

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
  organizationId: string | null
}> {
  const contentType = req.headers.get("content-type") || "" // What kind of body did the client send?

  // Phone forms often use multipart/form-data with a File field.
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData() // Parse the form fields
    const file = form.get("file") // The photo file
    if (!file || !(file instanceof File)) {
      throw new Error("Missing file field") // Need an actual file
    }
    if (file.size > MAX_BYTES) throw new Error("Image too large (max ~2.5MB)")
    const buf = Buffer.from(await file.arrayBuffer()) // Raw bytes → Buffer
    return {
      mimeType: file.type || "image/jpeg", // Default JPEG if browser omits type
      dataBase64: buf.toString("base64"), // Store as base64 text in Postgres
      id: form.get("id") != null ? String(form.get("id")).trim() : null,
      sku: form.get("sku") != null ? String(form.get("sku")).trim() : null,
      fccId: form.get("fccId") != null ? String(form.get("fccId")) : "",
      frequency: form.get("frequency") != null ? String(form.get("frequency")) : "",
      year: form.get("year") != null ? String(form.get("year")) : null,
      make: form.get("make") != null ? String(form.get("make")) : null,
      model: form.get("model") != null ? String(form.get("model")) : null,
      organizationId:
        form.get("organization_id") != null ? String(form.get("organization_id")).trim() : null,
    }
  }

  // Our Capture Key Image button sends JSON with compressed base64.
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
    organizationId: body.organization_id != null ? String(body.organization_id).trim() : null,
  }
}

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie")) // Who is uploading?
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  try {
    const payload = await readImageFromRequest(req) // Parse image + metadata
    let inventoryId = payload.id?.trim() || null // Prefer explicit inventory row id

    // If no id, find or create a row by SKU so the photo has a home.
    if (!inventoryId) {
      const sku = normalizeInventorySku(payload.sku || "")
      if (!sku) {
        return NextResponse.json(
          { error: "id or sku is required to attach a key photo" },
          { status: 400 }
        )
      }
      const existing = await getKeyInventoryBySku(userId, sku, payload.organizationId)
      if (existing) {
        inventoryId = existing.id
      } else {
        const created = await upsertKeyInventoryVan1Stock({
          userId,
          organizationId: payload.organizationId,
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

    // Save bytes + set image_url to /api/inventory/{id}/image?v=...
    const row = await updateKeyInventoryImage({
      userId,
      id: inventoryId,
      mimeType: payload.mimeType,
      dataBase64: payload.dataBase64,
    })
    if (!row) {
      return NextResponse.json({ error: "Inventory item not found" }, { status: 404 })
    }

    return NextResponse.json({
      data: {
        item: serializeKeyInventoryForApi([row])[0], // Updated row for the UI
        imageUrl: row.imageUrl, // Convenience field for the client
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Upload failed"
    console.error("[inventory/image]", e)
    const status = /too large/i.test(msg) ? 413 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
