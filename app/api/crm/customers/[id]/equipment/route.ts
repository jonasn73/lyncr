// GET /api/crm/customers/[id]/equipment — list (lightweight, for the intake sheet)
// POST /api/crm/customers/[id]/equipment — add (or upsert-by-kind from intake)
// PATCH /api/crm/customers/[id]/equipment — update brand/model/install year/notes
// DELETE /api/crm/customers/[id]/equipment — remove (e.g. unit replaced)
import { NextRequest, NextResponse } from "next/server"
import { resolveWorkspaceActor } from "@/lib/workspace-actor"
import { resolveIntakeWriteActor } from "@/lib/intake-write-auth"
import {
  createCustomerEquipmentForUser,
  deleteCustomerEquipmentForUser,
  getCustomerByIdForUser,
  isUndefinedRelationError,
  listCustomerEquipmentForCustomer,
  updateCustomerEquipmentForUser,
} from "@/lib/db"

export const runtime = "nodejs"
export const preferredRegion = "iad1"

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const actor = await resolveIntakeWriteActor(req.headers.get("cookie"))
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = actor.ownerUserId

  const { id } = await ctx.params
  const customer = await getCustomerByIdForUser(userId, id)
  if (!customer) return NextResponse.json({ error: "Not found" }, { status: 404 })

  try {
    const equipment = await listCustomerEquipmentForCustomer(userId, customer.id)
    return NextResponse.json({ data: { equipment } })
  } catch (e) {
    console.error("[GET /api/crm/customers/:id/equipment]", e)
    return NextResponse.json({ error: "Failed to load equipment" }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  // Equipment captured during intake belongs to the owner's CRM, whoever took the call.
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

  const kind = str("kind").trim()
  if (!kind) return NextResponse.json({ error: "kind is required" }, { status: 400 })

  try {
    // Upsert by kind — a customer has at most one water heater / HVAC unit / panel on file,
    // so a re-save from intake updates it in place instead of spawning a duplicate row.
    const existing = (await listCustomerEquipmentForCustomer(userId, customer.id)).find(
      (e) => e.kind === kind
    )
    const equipment = existing
      ? await updateCustomerEquipmentForUser({
          userId,
          customerId: customer.id,
          equipmentId: existing.id,
          brand: str("brand") || existing.brand,
          model: str("model") || existing.model,
          installYear: str("install_year") || str("installYear") || existing.install_year,
          notes: str("notes") || existing.notes,
        })
      : await createCustomerEquipmentForUser({
          userId,
          customerId: customer.id,
          kind,
          brand: str("brand"),
          model: str("model"),
          installYear: str("install_year") || str("installYear"),
          notes: str("notes"),
        })
    return NextResponse.json({ data: { equipment } })
  } catch (e) {
    if (isUndefinedRelationError(e, "customer_equipment")) {
      return NextResponse.json(
        {
          error: "Customer equipment table missing",
          migration: "scripts/164-customer-equipment-crm.sql",
        },
        { status: 503 }
      )
    }
    console.error("[POST /api/crm/customers/:id/equipment]", e)
    return NextResponse.json({ error: "Failed to add equipment" }, { status: 500 })
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

  const equipmentId = String(body.equipmentId ?? body.id ?? "").trim()
  if (!equipmentId) {
    return NextResponse.json({ error: "equipmentId is required" }, { status: 400 })
  }

  const str = (k: string) =>
    typeof body[k] === "string" ? (body[k] as string) : body[k] != null ? String(body[k]) : ""

  try {
    const equipment = await updateCustomerEquipmentForUser({
      userId,
      customerId: customer.id,
      equipmentId,
      brand: str("brand"),
      model: str("model"),
      installYear: str("install_year") || str("installYear"),
      notes: str("notes"),
    })
    if (!equipment) {
      return NextResponse.json({ error: "Equipment not found" }, { status: 404 })
    }
    return NextResponse.json({ data: { equipment } })
  } catch (e) {
    if (isUndefinedRelationError(e, "customer_equipment")) {
      return NextResponse.json(
        {
          error: "Customer equipment table missing",
          migration: "scripts/164-customer-equipment-crm.sql",
        },
        { status: 503 }
      )
    }
    console.error("[PATCH /api/crm/customers/:id/equipment]", e)
    return NextResponse.json({ error: "Failed to update equipment" }, { status: 500 })
  }
}

export async function DELETE(
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

  const equipmentId = req.nextUrl.searchParams.get("equipmentId")?.trim() || ""
  if (!equipmentId) {
    return NextResponse.json({ error: "equipmentId is required" }, { status: 400 })
  }

  try {
    const ok = await deleteCustomerEquipmentForUser({
      userId,
      customerId: customer.id,
      equipmentId,
    })
    if (!ok) return NextResponse.json({ error: "Equipment not found" }, { status: 404 })
    return NextResponse.json({ data: { ok: true } })
  } catch (e) {
    if (isUndefinedRelationError(e, "customer_equipment")) {
      return NextResponse.json({ error: "Customer equipment table missing" }, { status: 503 })
    }
    console.error("[DELETE /api/crm/customers/:id/equipment]", e)
    return NextResponse.json({ error: "Failed to delete equipment" }, { status: 500 })
  }
}
