// POST /api/porting/orders/[id]/reply — owner reply to Telnyx porting desk thread.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getPortingOrderByIdForOwner, patchPortingOrderFields } from "@/lib/db"
import { createTelnyxPortingOrderComment } from "@/lib/telnyx-porting-orders"
import { submitTelnyxPortingPinCorrection } from "@/lib/telnyx-lnp-update"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const { id } = await ctx.params
  const order = await getPortingOrderByIdForOwner(id, userId)
  if (!order) return NextResponse.json({ error: "Port order not found" }, { status: 404 })

  const telnyxOrderId = order.telnyx_order_id?.trim()
  if (!telnyxOrderId) {
    return NextResponse.json({ error: "This order has no Telnyx order id yet" }, { status: 400 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    message?: string
    body?: string
    pin?: string
    pin_or_sid?: string
  }
  const message = String(body.message ?? body.body ?? "").trim()
  const pin = String(body.pin ?? body.pin_or_sid ?? "").trim()

  if (!message && !pin) {
    return NextResponse.json({ error: "Enter a reply or corrected PIN" }, { status: 400 })
  }

  try {
    if (pin) {
      const telnyx = await submitTelnyxPortingPinCorrection(telnyxOrderId, pin)
      await patchPortingOrderFields(id, {
        pin_or_sid: pin,
        status: telnyx.orderStatus === "rejected" ? "action_required" : telnyx.orderStatus,
        telnyx_status: telnyx.telnyxStatus,
        carrier_rejection_reason: null,
      })
    }

    if (message) {
      if (message.length > 8000) {
        return NextResponse.json({ error: "Message too long" }, { status: 400 })
      }
      await createTelnyxPortingOrderComment(telnyxOrderId, message)
      if (!pin) {
        await patchPortingOrderFields(id, {
          status: order.status === "rejected" ? "action_required" : order.status,
        })
      }
    }

    return NextResponse.json({
      success: true,
      message: "Update sent to the porting desk.",
    })
  } catch (e) {
    console.error("[POST /api/porting/orders/reply] failed:", e)
    const msg = e instanceof Error ? e.message : "Could not send update"
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
