// GET /api/crm/customers/[id] — profile: customer + vehicles + service history
import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  getCustomerByIdForUser,
  listCrmServiceHistoryForCustomer,
  listCustomerVehiclesForCustomer,
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
