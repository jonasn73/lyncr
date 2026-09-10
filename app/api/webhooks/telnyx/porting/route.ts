// ============================================
// POST /api/webhooks/telnyx/porting
// ============================================
// Legacy alias — delegates to the shared porting webhook handler.

import { NextRequest } from "next/server"
import { processTelnyxPortingWebhook } from "@/lib/telnyx-porting-webhook-handler"
import { warnOnInvalidTelnyxSignature } from "@/lib/telnyx"

export const runtime = "nodejs"
export const preferredRegion = "iad1"

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    const raw = await req.text()
    warnOnInvalidTelnyxSignature(req.headers, raw, "webhooks/telnyx/porting")
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
