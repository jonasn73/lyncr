// ============================================
// POST /api/webhooks/telnyx
// ============================================
// Primary Telnyx webhook entry for:
//   - Port-in lifecycle (porting_order.*, sub_request.exception)
//   - 10DLC brand/campaign status (10dlc.*.update, brand.vetted, brand.created, …)
//
// Per-order porting webhook_url is set in lib/telnyx-lnp-submit.ts.
// Brand/campaign webhookURL is set in lib/telnyx-10dlc.ts on create.

import { NextRequest } from "next/server"
import { processTelnyxPortingWebhook } from "@/lib/telnyx-porting-webhook-handler"
import { processTelnyx10DlcWebhook } from "@/lib/telnyx-10dlc-webhook-handler"
import {
  extractTelnyx10DlcEventType,
  isTelnyx10DlcWebhookEvent,
} from "@/lib/telnyx-10dlc-webhook"
import { extractEventType, isTelnyxPortingWebhookEvent } from "@/lib/telnyx-porting-webhook"

export const runtime = "nodejs"
export const preferredRegion = "iad1"

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    const raw = await req.text()
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const portingEventType = extractEventType(body)
  const tenDlcEventType = extractTelnyx10DlcEventType(body)
  const eventType = tenDlcEventType || portingEventType

  try {
    if (isTelnyx10DlcWebhookEvent(eventType)) {
      return await processTelnyx10DlcWebhook(body)
    }
    if (isTelnyxPortingWebhookEvent(eventType) || !eventType) {
      // Unknown / empty event types still go through the porting handler (legacy shapes).
      return await processTelnyxPortingWebhook(body)
    }
    // Recognized but unsupported event — ACK so Telnyx stops retrying.
    return Response.json({ received: true, handled: false, event_type: eventType })
  } catch (e) {
    console.error("[telnyx/webhook] handler error:", e)
    return Response.json({ error: "Storage failed" }, { status: 500 })
  }
}
