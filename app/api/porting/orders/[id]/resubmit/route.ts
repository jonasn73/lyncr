// PATCH/POST /api/porting/orders/[id]/resubmit — owner correction scoped to one porting_orders row.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getPortingOrderByIdForOwner, patchPortingOrderFields } from "@/lib/db"
import { orderRequiresPinCorrection } from "@/lib/porting-pin-correction"
import { validatePortingDeskSubmission } from "@/lib/porting-desk-validation"
import { createTelnyxPortingOrderComment } from "@/lib/telnyx-porting-orders"
import { submitTelnyxPortingPinCorrection } from "@/lib/telnyx-lnp-update"

export const dynamic = "force-dynamic"

type ResubmitBody = {
  porting_order_id?: string
  telnyx_order_id?: string
  phone_number?: string
  message?: string
  body?: string
  pin?: string
  pin_or_sid?: string
}

async function handleResubmit(req: NextRequest, id: string) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const order = await getPortingOrderByIdForOwner(id, userId)
  if (!order) return NextResponse.json({ error: "Port order not found" }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as ResubmitBody

  if (body.porting_order_id?.trim() && body.porting_order_id.trim() !== id) {
    return NextResponse.json({ error: "Port order id mismatch for this transfer" }, { status: 400 })
  }

  const telnyxOrderId = order.telnyx_order_id?.trim()
  if (!telnyxOrderId) {
    return NextResponse.json({ error: "This transfer has no carrier ticket id yet" }, { status: 400 })
  }

  if (body.telnyx_order_id?.trim() && body.telnyx_order_id.trim() !== telnyxOrderId) {
    return NextResponse.json({ error: "Carrier ticket id does not match this line" }, { status: 400 })
  }

  if (body.phone_number?.trim()) {
    const norm = (v: string) => v.replace(/\D/g, "")
    if (norm(body.phone_number) !== norm(order.phone_number)) {
      return NextResponse.json({ error: "Phone number does not match this transfer" }, { status: 400 })
    }
  }

  const message = String(body.message ?? body.body ?? "").trim()
  const pin = String(body.pin ?? body.pin_or_sid ?? "").trim()
  const pinRequired = orderRequiresPinCorrection(order)

  const deskValidation = validatePortingDeskSubmission({
    order,
    pinRequired,
    pin,
    message,
  })
  if (!deskValidation.ok) {
    return NextResponse.json({ error: deskValidation.message }, { status: 400 })
  }

  if (pinRequired && !pin) {
    return NextResponse.json(
      { error: "Enter your 4–8 digit transfer PIN to clear this carrier exception." },
      { status: 400 }
    )
  }

  if (!message && !pin) {
    return NextResponse.json({ error: "Enter a correction message or updated PIN" }, { status: 400 })
  }

  try {
    if (pin) {
      const telnyx = await submitTelnyxPortingPinCorrection(telnyxOrderId, pin)
      const stillException = telnyx.telnyxStatus.toLowerCase().includes("exception")
      await patchPortingOrderFields(id, {
        pin_or_sid: pin,
        status: stillException ? "action_required" : telnyx.orderStatus,
        telnyx_status: telnyx.telnyxStatus,
        carrier_rejection_reason: stillException ? order.carrier_rejection_reason : null,
      })
    }

    if (message && !pinRequired) {
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

    const pinSaved = Boolean(pin)
    return NextResponse.json({
      success: true,
      message: pinSaved
        ? "PIN saved on your carrier port order. Telnyx is re-reviewing the transfer — refresh the portal in a minute to confirm."
        : "Correction submitted to the carrier desk for this line.",
      data: {
        porting_order_id: id,
        telnyx_order_id: telnyxOrderId,
        phone_number: order.phone_number,
        pin_saved: pinSaved,
      },
    })
  } catch (e) {
    console.error("[porting/resubmit] failed:", e)
    const msg = e instanceof Error ? e.message : "Could not submit correction"
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return handleResubmit(req, id)
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return handleResubmit(req, id)
}
