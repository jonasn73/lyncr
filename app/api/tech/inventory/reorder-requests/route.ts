// POST /api/tech/inventory/reorder-requests — tech flags an out-of-stock key from Key
// Lookup ("Add to order list"), queuing it for the owner to approve.

import { NextRequest, NextResponse } from "next/server"
import { resolveActor } from "@/lib/actor"
import { getFieldTechContext } from "@/lib/field-tech-auth"
import { createReorderRequest } from "@/lib/key-reorder-requests"

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

  const tiSku = String(body.tiSku ?? body.ti_sku ?? "").trim()
  if (!tiSku) return NextResponse.json({ error: "tiSku is required" }, { status: 400 })

  const ctx = await getFieldTechContext(actor.actingUserId)

  try {
    const request = await createReorderRequest({
      ownerUserId: actor.ownerUserId,
      organizationId: ctx?.technician.organization_id ?? null,
      tiSku,
      title: body.title != null ? String(body.title) : "",
      fccId: body.fccId != null ? String(body.fccId) : "",
      productUrl: body.productUrl != null ? String(body.productUrl) : "",
      imageUrl: body.imageUrl != null ? String(body.imageUrl) : null,
      vehicleYear: body.vehicleYear != null ? String(body.vehicleYear) : null,
      vehicleMake: body.vehicleMake != null ? String(body.vehicleMake) : null,
      vehicleModel: body.vehicleModel != null ? String(body.vehicleModel) : null,
      quantity: body.quantity != null ? Number(body.quantity) : 1,
      requestedBy: {
        role: "field_tech",
        userId: actor.actingUserId,
        label: ctx?.technician.name?.trim() || "Technician",
      },
    })
    return NextResponse.json({ data: { request } }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not create reorder request"
    console.error("[tech/inventory/reorder-requests POST]", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
