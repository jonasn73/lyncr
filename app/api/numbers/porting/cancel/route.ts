// ============================================
// POST /api/numbers/porting/cancel
// ============================================
// Cancels or deletes a porting order by ID.
// Draft orders must be DELETEd. Submitted orders use /actions/cancel.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"

const TELNYX_BASE = "https://api.telnyx.com/v2"

function getApiKey(): string {
  const key = process.env.TELNYX_API_KEY
  if (!key) throw new Error("Missing TELNYX_API_KEY")
  return key
}

const authHeaders = () => ({
  Authorization: `Bearer ${getApiKey()}`,
  "Content-Type": "application/json",
})

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const body = await req.json()
    const orderId = body?.order_id

    if (!orderId) {
      return NextResponse.json({ error: "order_id is required" }, { status: 400 })
    }

    // Try DELETE first (works for draft orders)
    const deleteRes = await fetch(`${TELNYX_BASE}/porting_orders/${orderId}`, {
      method: "DELETE",
      headers: authHeaders(),
    })

    if (deleteRes.ok || deleteRes.status === 204) {
      console.log(`[Sigo] Deleted draft port order ${orderId}`)
      return NextResponse.json({ success: true })
    }

    // If DELETE fails (order not in draft), try cancel action
    const cancelRes = await fetch(`${TELNYX_BASE}/porting_orders/${orderId}/actions/cancel`, {
      method: "POST",
      headers: authHeaders(),
    })

    if (cancelRes.ok) {
      console.log(`[Sigo] Cancelled port order ${orderId}`)
      return NextResponse.json({ success: true })
    }

    const errBody = await cancelRes.json().catch(() => ({}))
    const errMsg = errBody?.errors?.[0]?.detail || `Failed to cancel (HTTP ${cancelRes.status})`
    console.error(`[Sigo] Cancel failed for order ${orderId}: ${errMsg}`)
    return NextResponse.json({ error: errMsg }, { status: cancelRes.status })
  } catch (error: unknown) {
    console.error("[Sigo] Cancel port error:", error)
    return NextResponse.json({ error: "Failed to cancel port order" }, { status: 500 })
  }
}
