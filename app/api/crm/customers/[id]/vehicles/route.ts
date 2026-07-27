// POST /api/crm/customers/[id]/vehicles — add a garage vehicle
import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  createCustomerVehicleForUser,
  getCustomerByIdForUser,
  isUndefinedRelationError,
  upsertCustomerVehicleFromIntake,
} from "@/lib/db"

export const runtime = "nodejs"
export const preferredRegion = "iad1"

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

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
