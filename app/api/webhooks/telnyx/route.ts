// ============================================
// POST /api/webhooks/telnyx
// ============================================
// Primary Telnyx webhook entry for port-in lifecycle events:
//   - porting_order.status_changed
//   - porting_order.comment_created
//   - sub_request.exception
//
// Per-order webhook_url is set on create in lib/telnyx-lnp-submit.ts.

import { NextRequest } from "next/server"
import { processTelnyxPortingWebhook } from "@/lib/telnyx-porting-webhook-handler"

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

  try {
    return await processTelnyxPortingWebhook(body)
  } catch (e) {
    console.error("[telnyx/webhook] porting handler error:", e)
    return Response.json({ error: "Storage failed" }, { status: 500 })
  }
}
