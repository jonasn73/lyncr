// POST /api/webhooks/telnyx/voice — Telnyx Call Control (Voice API v2) event pipeline.

import * as Sentry from "@sentry/nextjs"
import { after, NextRequest, NextResponse } from "next/server"
import { prefetchHoldMusicPlaybackContent } from "@/lib/hold-inline-audio"
import {
  handleTelnyxCallControlVoiceWebhook,
  readInboundCallControlEnabled,
} from "@/lib/telnyx-call-control-inbound"
import { validateTelnyxRequest } from "@/lib/telnyx"
import { alertOnInvalidTelnyxSignature } from "@/lib/telnyx-webhook-alerts"

export const runtime = "nodejs"
export const preferredRegion = "iad1"
export const dynamic = "force-dynamic"

// Warm inline hold WAV in memory so Busy stay-on-line is not waiting on disk.
prefetchHoldMusicPlaybackContent()

export async function POST(req: NextRequest) {
  if (!readInboundCallControlEnabled()) {
    return NextResponse.json({ error: "Call Control inbound is disabled" }, { status: 404 })
  }

  let body: Record<string, unknown>
  let raw: string
  try {
    raw = await req.text()
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // Enforced 2026-09-10 — a multi-hour window of real production traffic logged zero
  // signature failures on this route (see lib/telnyx.ts for the other 3 webhook routes,
  // still fail-open pending the same confirmation).
  const signature = req.headers.get("telnyx-signature-ed25519") || ""
  const timestamp = req.headers.get("telnyx-timestamp") || ""
  if (!validateTelnyxRequest(raw, signature, timestamp)) {
    console.error("[telnyx/voice] rejected: invalid or missing webhook signature")
    after(() => alertOnInvalidTelnyxSignature("webhooks/telnyx/voice", true))
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  try {
    await handleTelnyxCallControlVoiceWebhook(body)
    return NextResponse.json({ ok: true })
  } catch (e) {
    // Log full stack but ACK 200 — a 500 makes Telnyx retry and can leave callers stranded.
    // Sentry.captureException here specifically because this catch already swallows the
    // error — an error caught like this never reaches Sentry's automatic instrumentation
    // on its own, so without this call a real failure here was invisible except to
    // whoever happened to go looking through raw Vercel logs.
    console.error("[telnyx/voice] Call Control handler error:", e)
    Sentry.captureException(e)
    return NextResponse.json({ ok: true, degraded: true })
  }
}
