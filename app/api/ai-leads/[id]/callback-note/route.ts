// PATCH /api/ai-leads/[id]/callback-note — update Action Required text on a CRM lead.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { updateAiLeadActionRequired } from "@/lib/db"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, context: RouteParams) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const { id } = await context.params
  const leadId = id?.trim()
  if (!leadId) return NextResponse.json({ error: "Lead id is required" }, { status: 400 })

  const body = (await req.json().catch(() => ({}))) as {
    action_required?: string | null
    sales_recovery_stage?: string | null
  }
  const actionRequired = String(body.action_required ?? "").trim()
  if (!actionRequired) {
    return NextResponse.json({ error: "action_required is required" }, { status: 400 })
  }
  const salesRecoveryStage = body.sales_recovery_stage?.trim() || null

  try {
    const ok = await updateAiLeadActionRequired(userId, leadId, actionRequired, salesRecoveryStage)
    if (!ok) return NextResponse.json({ error: "Lead not found" }, { status: 404 })
    return NextResponse.json({
      data: { id: leadId, action_required: actionRequired, sales_recovery_stage: salesRecoveryStage },
    })
  } catch (e) {
    console.error("[PATCH /api/ai-leads/[id]/callback-note]", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not save callback note." },
      { status: 500 }
    )
  }
}
