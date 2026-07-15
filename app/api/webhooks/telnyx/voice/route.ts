// POST /api/webhooks/telnyx/voice — Telnyx Call Control (Voice API v2) event pipeline.

import { NextRequest, NextResponse } from "next/server"
import {
  handleTelnyxCallControlVoiceWebhook,
  readInboundCallControlEnabled,
} from "@/lib/telnyx-call-control-inbound"

export const runtime = "nodejs"
export const preferredRegion = "iad1"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  if (!readInboundCallControlEnabled()) {
    return NextResponse.json({ error: "Call Control inbound is disabled" }, { status: 404 })
  }

  let body: Record<string, unknown>
  try {
    const raw = await req.text()
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  try {
    await handleTelnyxCallControlVoiceWebhook(body)
    return NextResponse.json({ ok: true })
  } catch (e) {
    // Log full stack but ACK 200 — a 500 makes Telnyx retry and can leave callers stranded.
    console.error("[telnyx/voice] Call Control handler error:", e)
    return NextResponse.json({ ok: true, degraded: true })
  }
}
