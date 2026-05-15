// ============================================
// POST /api/webhooks/telnyx/porting
// ============================================
// Telnyx sends port-in events (status changes, comments, etc.) when `webhook_url`
// is set on the porting order — see POST /api/numbers/port and Telnyx port-in notifications docs.

import { NextRequest, NextResponse } from "next/server"
import { insertPortingNotificationIfNew } from "@/lib/db"
import {
  buildPortingNotificationText,
  buildPortingNotificationTitle,
  customerRefToUserId,
  extractEventType,
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
        hint: "Set customer_reference zing-<userId> on port orders (Sigo does this automatically; legacy prefix zing-).",
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
    console.log(
      JSON.stringify({
        zing: "telnyx-porting-webhook",
        userId,
        eventType,
        eventId,
        inserted,
      })
    )
    return NextResponse.json({ received: true, stored: inserted })
  } catch (e) {
    console.error("[Sigo] telnyx-porting-webhook insert error:", e)
    return NextResponse.json({ error: "Storage failed" }, { status: 500 })
  }
}
