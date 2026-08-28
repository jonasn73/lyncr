// POST /api/crm/customers/[id]/vehicles — add a garage vehicle
// PATCH /api/crm/customers/[id]/vehicles — update year/make/model/VIN on an existing vehicle
import { NextRequest, NextResponse } from "next/server"
import { resolveWorkspaceActor } from "@/lib/workspace-actor"
import { resolveIntakeWriteActor } from "@/lib/intake-write-auth"
import {
  createCustomerVehicleForUser,
  getCustomerByIdForUser,
  isUndefinedRelationError,
  updateCustomerVehicleForUser,
  upsertCustomerVehicleFromIntake,
} from "@/lib/db"

export const runtime = "nodejs"
export const preferredRegion = "iad1"

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  // Vehicle captured during intake belongs to the owner's CRM, whoever took the call.
  const actor = await resolveIntakeWriteActor(req.headers.get("cookie"))
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = actor.ownerUserId

  const { id } = await ctx.params
  const customer = await getCustomerByIdForUser(userId, id)
  if (!customer) return NextResponse.json({ error: "Not found" }, { status: 404 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const str = (k: string) =>
    typeof body[k] === "string" ? (body[k] as string) : body[k] != null ? String(body[k]) : ""

  try {
    const year = str("year")
    const make = str("make")
    const model = str("model")
    // Prefer upsert by YMM so intake re-saves don’t spam duplicate garage rows.
    const vehicle =
      (await upsertCustomerVehicleFromIntake({
        userId,
        customerId: customer.id,
        year,
        make,
        model,
        vin: str("vin"),
        fccId: str("fcc_id") || str("fccId"),
      })) ??
      (await createCustomerVehicleForUser({
        userId,
        customerId: customer.id,
        year,
        make,
        model,
        vin: str("vin"),
        fccId: str("fcc_id") || str("fccId"),
        notes: str("notes"),
      }))
    return NextResponse.json({ data: { vehicle } })
  } catch (e) {
    if (isUndefinedRelationError(e, "customer_vehicles")) {
      return NextResponse.json(
        {
          error: "Vehicle garage table missing",
          migration: "scripts/120-customer-vehicles-crm.sql",
        },
        { status: 503 }
      )
    }
    console.error("[POST /api/crm/customers/:id/vehicles]", e)
    return NextResponse.json({ error: "Failed to add vehicle" }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const actor = await resolveWorkspaceActor(req.headers.get("cookie"), {
    capability: "crm_edit",
  })
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = actor.ownerUserId

  const { id } = await ctx.params
  const customer = await getCustomerByIdForUser(userId, id)
  if (!customer) return NextResponse.json({ error: "Not found" }, { status: 404 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const vehicleId = String(body.vehicleId ?? body.id ?? "").trim()
  if (!vehicleId) {
    return NextResponse.json({ error: "vehicleId is required" }, { status: 400 })
  }

  const str = (k: string) =>
    typeof body[k] === "string" ? (body[k] as string) : body[k] != null ? String(body[k]) : ""

  try {
    const vehicle = await updateCustomerVehicleForUser({
      userId,
      customerId: customer.id,
      vehicleId,
      year: str("year"),
      make: str("make"),
      model: str("model"),
      vin: str("vin"),
      fccId: body.fcc_id !== undefined || body.fccId !== undefined
        ? str("fcc_id") || str("fccId")
        : undefined,
    })
    if (!vehicle) {
      return NextResponse.json({ error: "Vehicle not found" }, { status: 404 })
    }
    return NextResponse.json({ data: { vehicle } })
  } catch (e) {
    if (isUndefinedRelationError(e, "customer_vehicles")) {
      return NextResponse.json(
        {
          error: "Vehicle garage table missing",
          migration: "scripts/120-customer-vehicles-crm.sql",
        },
        { status: 503 }
      )
    }
    console.error("[PATCH /api/crm/customers/:id/vehicles]", e)
    return NextResponse.json({ error: "Failed to update vehicle" }, { status: 500 })
  }
}
