// ============================================
// POST /api/webhooks/telnyx/messaging
// ============================================
// Telnyx Messaging webhook — inbound SMS (message.received) + delivery
// (message.sent / message.finalized / message.failed).
// Also reachable at POST /api/messaging/webhook (same handler).

import { after } from "next/server"
import { NextRequest, NextResponse } from "next/server"
import { processInboundTelnyxMessage, type TelnyxMessagingWebhook } from "@/lib/sms-inbound-handler"
import { validateTelnyxRequest } from "@/lib/telnyx"
import { alertOnInvalidTelnyxSignature } from "@/lib/telnyx-webhook-alerts"

export const runtime = "nodejs"

const ACK = NextResponse.json({ ok: true })

export async function POST(req: NextRequest) {
  let body: TelnyxMessagingWebhook | null = null
  let raw: string
  try {
    raw = await req.text()
    body = raw ? (JSON.parse(raw) as TelnyxMessagingWebhook) : null
  } catch {
    return ACK
  }
  if (!body) return ACK

  const signature = req.headers.get("telnyx-signature-ed25519") || ""
  const timestamp = req.headers.get("telnyx-timestamp") || ""
  if (!validateTelnyxRequest(raw, signature, timestamp)) {
    console.error("[telnyx/messaging webhook] rejected: invalid or missing webhook signature")
    after(() => alertOnInvalidTelnyxSignature("webhooks/telnyx/messaging", true))
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  after(async () => {
    try {
      await processInboundTelnyxMessage(body!)
    } catch (e) {
      console.error("[telnyx/messaging webhook]", e)
    }
  })

  return ACK
}
