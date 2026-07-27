// GET /api/crm/customers/[id] — profile: customer + vehicles + service history
// PATCH /api/crm/customers/[id] — edit display name, notes, and/or lead appointment
import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  getCustomerByIdForUser,
  listCrmServiceHistoryForCustomer,
  listCustomerVehiclesForCustomer,
  updateCrmLeadAppointmentForUser,
  updateCustomerFieldsForUser,
} from "@/lib/db"

export const runtime = "nodejs"
export const preferredRegion = "iad1"

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await ctx.params
  if (!id?.trim()) return NextResponse.json({ error: "Missing id" }, { status: 400 })

  try {
    const customer = await getCustomerByIdForUser(userId, id)
    if (!customer) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const [vehicles, history] = await Promise.all([
      listCustomerVehiclesForCustomer(userId, customer.id),
      listCrmServiceHistoryForCustomer({
        userId,
        customerId: customer.id,
        phoneE164: customer.phone_e164,
      }),
    ])

    return NextResponse.json({
      data: { customer, vehicles, history },
    })
  } catch (e) {
    console.error("[GET /api/crm/customers/:id]", e)
    return NextResponse.json({ error: "Failed to load profile" }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await ctx.params
  if (!id?.trim()) return NextResponse.json({ error: "Missing id" }, { status: 400 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const hasName = typeof body.display_name === "string"
  const hasNotes = typeof body.notes === "string"
  const leadId =
    typeof body.appointment_lead_id === "string" ? body.appointment_lead_id.trim() : ""
  const hasAppointment = "scheduled_at" in body && leadId.length > 0

  if (!hasName && !hasNotes && !hasAppointment) {
    return NextResponse.json(
      { error: "Provide display_name, notes, and/or scheduled_at + appointment_lead_id" },
      { status: 400 }
    )
  }

  try {
    let customer = await getCustomerByIdForUser(userId, id)
    if (!customer) return NextResponse.json({ error: "Not found" }, { status: 404 })

    if (hasName || hasNotes) {
      const updated = await updateCustomerFieldsForUser(userId, id, {
        ...(hasName ? { displayName: String(body.display_name) } : {}),
        ...(hasNotes ? { notes: String(body.notes) } : {}),
      })
      if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 })
      customer = updated
    }

    if (hasAppointment) {
      const raw = body.scheduled_at
      let scheduledAtIso: string | null = null
      if (raw != null && String(raw).trim() !== "") {
        const parsed = Date.parse(String(raw))
        if (Number.isNaN(parsed)) {
          return NextResponse.json({ error: "scheduled_at must be a valid date" }, { status: 400 })
        }
        scheduledAtIso = new Date(parsed).toISOString()
      }
      const ok = await updateCrmLeadAppointmentForUser(userId, leadId, scheduledAtIso)
      if (!ok) {
        return NextResponse.json({ error: "Lead/job not found for appointment" }, { status: 404 })
      }
    }

    const [vehicles, history] = await Promise.all([
      listCustomerVehiclesForCustomer(userId, customer.id),
      listCrmServiceHistoryForCustomer({
        userId,
        customerId: customer.id,
        phoneE164: customer.phone_e164,
      }),
    ])

    return NextResponse.json({ data: { customer, vehicles, history } })
  } catch (e) {
    console.error("[PATCH /api/crm/customers/:id]", e)
    return NextResponse.json({ error: "Failed to save profile" }, { status: 500 })
  }
}
