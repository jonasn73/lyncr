// ============================================
// POST /api/voice/telnyx/ai-lead-intake/u/{userId}
// ============================================
// Telnyx Voice AI tool / webhook target — stores captured lead rows in ai_leads.

import { NextRequest, NextResponse } from "next/server"
import { normalizePhoneNumberE164 } from "@/lib/db"
import { saveCallIntake } from "@/lib/intake-engine"

export const runtime = "nodejs"
export const preferredRegion = "iad1"
export const dynamic = "force-dynamic"

type RouteCtx = { params: Promise<{ userId: string }> }

function readWebhookSecret(): string {
  return (process.env.ZING_AI_LEAD_INTAKE_SECRET || process.env.TELNYX_WEBHOOK_SECRET || "").trim()
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const { userId } = await ctx.params
  if (!userId?.trim()) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 })
  }

  const secret = readWebhookSecret()
  const isProd =
    process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production"
  // Fail closed in production — unauthenticated writes of ai_leads are not allowed.
  if (!secret && isProd) {
    return NextResponse.json(
      { error: "AI lead intake secret not configured" },
      { status: 503 }
    )
  }
  if (secret) {
    const provided =
      req.headers.get("x-zing-ai-lead-secret")?.trim() ||
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
      ""
    if (provided !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const callerRaw = String(body.caller_e164 || body.from || body.phone || "").trim()
  const caller_e164 = callerRaw ? normalizePhoneNumberE164(callerRaw) : null
  const intent_slug =
    typeof body.intent_slug === "string" && body.intent_slug.trim()
      ? body.intent_slug.trim()
      : typeof body.intent === "string" && body.intent.trim()
        ? body.intent.trim()
        : null
  const summary =
    typeof body.summary === "string" && body.summary.trim() ? body.summary.trim() : null
  const collected =
    body.collected && typeof body.collected === "object" && !Array.isArray(body.collected)
      ? (body.collected as Record<string, unknown>)
      : { ...body }
  const vapi_call_id =
    typeof body.vapi_call_id === "string" && body.vapi_call_id.trim()
      ? body.vapi_call_id.trim()
      : typeof body.call_sid === "string" && body.call_sid.trim()
        ? body.call_sid.trim()
        : null

  try {
    const result = await saveCallIntake({
      user_id: userId.trim(),
      caller_e164,
      intent_slug,
      collected,
      summary,
      vapi_call_id,
    })
    return NextResponse.json({ data: { id: result.id, sms_sent: result.sms_sent } })
  } catch (e) {
    console.error("[POST /api/voice/telnyx/ai-lead-intake] failed:", e)
    return NextResponse.json({ error: "Could not save lead" }, { status: 500 })
  }
}
