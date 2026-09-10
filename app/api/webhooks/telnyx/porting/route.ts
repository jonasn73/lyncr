// ============================================
// POST /api/webhooks/telnyx/porting
// ============================================
// Legacy alias — delegates to the shared porting webhook handler.

import { after, NextRequest } from "next/server"
import { processTelnyxPortingWebhook } from "@/lib/telnyx-porting-webhook-handler"
import { validateTelnyxRequest } from "@/lib/telnyx"
import { alertOnInvalidTelnyxSignature } from "@/lib/telnyx-webhook-alerts"

export const runtime = "nodejs"
export const preferredRegion = "iad1"

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    const raw = await req.text()
    const signature = req.headers.get("telnyx-signature-ed25519") || ""
    const timestamp = req.headers.get("telnyx-timestamp") || ""
    if (!validateTelnyxRequest(raw, signature, timestamp)) {
      console.error("[telnyx/porting webhook] rejected: invalid or missing webhook signature")
      after(() => alertOnInvalidTelnyxSignature("webhooks/telnyx/porting", true))
      return Response.json({ error: "Invalid signature" }, { status: 401 })
    }
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  try {
    return await processTelnyxPortingWebhook(body)
  } catch (e) {
    console.error("[telnyx/porting webhook] error:", e)
    return Response.json({ error: "Storage failed" }, { status: 500 })
  }
}
