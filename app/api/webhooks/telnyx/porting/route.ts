// ============================================
// POST /api/webhooks/telnyx/porting
// ============================================
// Telnyx sends port-in events (status changes, comments, etc.) when `webhook_url`
// is set on the porting order — see POST /api/numbers/port and Telnyx port-in notifications docs.

import { NextRequest, NextResponse } from "next/server"
import { after } from "next/server"
import { insertPortingNotificationIfNew } from "@/lib/db"
import { SITE_NAME } from "@/lib/brand"
import { finalizePortedNumber } from "@/lib/port-number-finalize"
import { syncPortingOrderFromTelnyxWebhook, applyPortRejectionFromTelnyxWebhook } from "@/lib/porting-order-sync"
import {
  buildPortingNotificationText,
  buildPortingNotificationTitle,
  customerRefToUserId,
  extractEventType,
  extractPortingPhoneNumbers,
  extractTelnyxEventId,
  findPortingOrderId,
  findZingCustomerReference,
} from "@/lib/telnyx-porting-webhook"

export const runtime = "nodejs"
export const preferredRegion = "iad1"

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    const raw = await req.text()
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const customerRef = findZingCustomerReference(body)
  const userId = customerRef ? customerRefToUserId(customerRef) : null
  if (!userId) {
    console.log(
      JSON.stringify({
        zing: "telnyx-porting-webhook-no-zing-ref",
        eventType: extractEventType(body),
        hint: `Set customer_reference zing-<userId> on port orders (${SITE_NAME} does this automatically; legacy prefix zing-).`,
      })
    )
    return NextResponse.json({ received: true, stored: false, reason: "no_zing_customer_reference" })
  }

  const eventType = extractEventType(body)
  const eventId = extractTelnyxEventId(body)
  const orderId = findPortingOrderId(body)
  const title = buildPortingNotificationTitle(eventType)
  const text = buildPortingNotificationText(body)

  try {
    const inserted = await insertPortingNotificationIfNew({
      userId,
      telnyxEventId: eventId,
      portingOrderId: orderId,
      eventType,
      title,
      body: text,
      rawPayload: body,
    })

    const rejectionSync = await applyPortRejectionFromTelnyxWebhook({
      ownerUserId: userId,
      body,
      telnyxOrderId: orderId,
    })

    const orderSync = await syncPortingOrderFromTelnyxWebhook({
      ownerUserId: userId,
      body,
      telnyxOrderId: orderId,
    })

    if (orderSync.just_completed) {
      const numbers = [
        orderSync.phone_number?.trim(),
        ...extractPortingPhoneNumbers(body),
      ].filter(Boolean) as string[]
      const unique = [...new Set(numbers)]
      after(async () => {
        for (const phone of unique) {
          await finalizePortedNumber({
            ownerUserId: userId,
            phoneNumberE164: phone,
            telnyxOrderId: orderId,
          })
        }
      })
    }

    console.log(
      JSON.stringify({
        zing: "telnyx-porting-webhook",
        userId,
        eventType,
        eventId,
        inserted,
        porting_rejection_sync: rejectionSync,
        porting_order_sync: orderSync,
      })
    )
    return NextResponse.json({
      received: true,
      stored: inserted,
      porting_rejection_applied: rejectionSync.applied,
      porting_order_updated: orderSync.updated,
      porting_order_status: orderSync.status,
    })
  } catch (e) {
    console.error("[Sigo] telnyx-porting-webhook insert error:", e)
    return NextResponse.json({ error: "Storage failed" }, { status: 500 })
  }
}
