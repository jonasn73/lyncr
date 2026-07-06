// ============================================
// GET /api/ai-leads
// ============================================
// Lists AI-captured leads for the signed-in user.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { listAiLeadsForDashboard, reconcileMiscategorizedCrmLeads } from "@/lib/db"
import { saveCallIntake } from "@/lib/intake-engine"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const lim = Number(req.nextUrl.searchParams.get("limit") || "50")
  const safeLimit = Number.isFinite(lim) ? lim : 50
  try {
    await reconcileMiscategorizedCrmLeads(userId)
    const leads = await listAiLeadsForDashboard(userId, safeLimit)
    return NextResponse.json({ leads })
  } catch (e) {
    console.error("[GET /api/ai-leads] failed:", e)
    return NextResponse.json({
      leads: [],
      degraded: true,
      warning: "Could not load leads. Check server logs and Neon migration scripts/010-ai-leads-intake.sql.",
    })
  }
}

/** Authenticated dashboard intake (same shape as Telnyx ai-lead-intake webhook). */
export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const callerRaw = String(body.caller_e164 || body.from || "").trim()
  try {
    const result = await saveCallIntake({
      user_id: userId,
      caller_e164: callerRaw || null,
      intent_slug: typeof body.intent_slug === "string" ? body.intent_slug : null,
      collected:
        body.collected && typeof body.collected === "object" && !Array.isArray(body.collected)
          ? (body.collected as Record<string, unknown>)
          : {},
      summary: typeof body.summary === "string" ? body.summary : null,
      vapi_call_id: typeof body.vapi_call_id === "string" ? body.vapi_call_id : null,
    })
    return NextResponse.json({ data: { id: result.id, sms_sent: result.sms_sent } })
  } catch (e) {
    console.error("[POST /api/ai-leads] failed:", e)
    return NextResponse.json({ error: "Could not save lead" }, { status: 500 })
  }
}
