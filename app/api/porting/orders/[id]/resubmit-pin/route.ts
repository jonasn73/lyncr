// POST /api/porting/orders/[id]/resubmit-pin — owner corrects rejected port PIN via Telnyx LNP PATCH.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getPortingOrderById, patchPortingOrderFields } from "@/lib/db"
import { submitTelnyxPortingPinCorrection } from "@/lib/telnyx-lnp-update"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const { id } = await ctx.params
  const order = await getPortingOrderById(id)
  if (!order || order.owner_user_id !== userId) {
    return NextResponse.json({ error: "Port order not found" }, { status: 404 })
  }
  if (order.status !== "rejected") {
    return NextResponse.json({ error: "Only rejected port orders can be corrected here" }, { status: 400 })
  }

  const telnyxOrderId = order.telnyx_order_id?.trim()
  if (!telnyxOrderId) {
    return NextResponse.json({ error: "This order has no Telnyx order id yet" }, { status: 400 })
  }

  const body = (await req.json().catch(() => ({}))) as { pin?: string; pin_or_sid?: string }
  const pin = String(body.pin ?? body.pin_or_sid ?? "").trim()
  if (!pin) {
    return NextResponse.json({ error: "Enter the correct account PIN or passcode" }, { status: 400 })
  }

  try {
    const telnyx = await submitTelnyxPortingPinCorrection(telnyxOrderId, pin)
    const updated = await patchPortingOrderFields(id, {
      pin_or_sid: pin,
      status: telnyx.orderStatus === "rejected" ? "pending" : telnyx.orderStatus,
      telnyx_status: telnyx.telnyxStatus,
      carrier_rejection_reason: null,
    })

    return NextResponse.json({
      success: true,
      message: "Updated PIN sent to carrier. Your transfer is back in review.",
      data: { order: updated ?? order },
    })
  } catch (e) {
    console.error("[POST /api/porting/orders/resubmit-pin] failed:", e)
    const msg = e instanceof Error ? e.message : "Could not resubmit port correction"
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
