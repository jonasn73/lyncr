// POST /api/messaging/webhook — Telnyx inbound SMS (message.received).

import { after } from "next/server"
import { NextRequest, NextResponse } from "next/server"
import { processInboundTelnyxMessage, type TelnyxMessagingWebhook } from "@/lib/sms-inbound-handler"

export const runtime = "nodejs"

const ACK = NextResponse.json({ ok: true })

export async function POST(req: NextRequest) {
  let body: TelnyxMessagingWebhook | null = null
  try {
    body = (await req.json()) as TelnyxMessagingWebhook
  } catch {
    return ACK
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
