// POST /api/messaging/webhook — Telnyx inbound SMS (message.received).

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
    console.error("[messaging/webhook] rejected: invalid or missing webhook signature")
    after(() => alertOnInvalidTelnyxSignature("messaging/webhook", true))
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  after(async () => {
    try {
      await processInboundTelnyxMessage(body!)
    } catch (e) {
      console.error("[POST /api/messaging/webhook]", e)
    }
  })

  return ACK
}
