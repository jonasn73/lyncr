// Debug endpoint — shows raw Telnyx porting data (phone numbers, customer references).
// Platform-admin only: this is carrier/customer data, not safe to expose publicly.
import { NextRequest, NextResponse } from "next/server"
import { requirePlatformAdmin } from "@/lib/admin-api-guard"

const TELNYX_BASE = "https://api.telnyx.com/v2"

function getApiKey(): string {
  const key = process.env.TELNYX_API_KEY
  if (!key) throw new Error("Missing TELNYX_API_KEY")
  return key
}

export async function GET(req: NextRequest) {
  const ctx = await requirePlatformAdmin(req)
  if (ctx instanceof NextResponse) return ctx
  try {
    const res = await fetch(
      `${TELNYX_BASE}/porting_orders?page[size]=50&sort=-created_at&include_phone_numbers=true`,
      {
        headers: {
          Authorization: `Bearer ${getApiKey()}`,
          "Content-Type": "application/json",
        },
      }
    )

    const body = await res.json()

    if (!res.ok) {
      return NextResponse.json({ error: body, status: res.status }, { status: 200 })
    }

    const orders = body?.data || []

    // Summarize each order for easy reading
    const summary = orders.map((o: Record<string, unknown>) => ({
      id: o.id,
      status: o.porting_order_status,
      created_at: o.created_at,
      phone_numbers: (o.phone_numbers as Record<string, unknown>[])?.map(
        (p: Record<string, unknown>) => p.phone_number
      ) || [],
      foc_date: (o.activation_settings as Record<string, unknown>)?.foc_datetime_requested || null,
      customer_reference: o.customer_reference,
    }))

    return NextResponse.json({
      total_orders: orders.length,
      orders: summary,
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
