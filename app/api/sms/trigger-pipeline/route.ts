// ============================================
// POST /api/sms/trigger-pipeline
// ============================================
// Fires one phase of the automated customer SMS pipeline for a job. Honors the owner's toggles and
// renders their custom template before dispatching a white-labeled text. Callable by the job's owner
// or by the field tech it's assigned to (e.g. when they press "Start Route").

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getLeadDispatchContext, getUser } from "@/lib/db"
import { runSmsPipeline, type SmsPhase } from "@/lib/sms-pipeline"

export const dynamic = "force-dynamic"

const PHASES = new Set<SmsPhase>(["booking", "route", "review"])

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    leadId?: string
    phase?: string
    techName?: string
  }
  const leadId = String(body.leadId || "").trim()
  const phase = String(body.phase || "").trim() as SmsPhase
  if (!leadId) return NextResponse.json({ error: "leadId is required" }, { status: 400 })
  if (!PHASES.has(phase)) return NextResponse.json({ error: "Invalid phase" }, { status: 400 })

  const ctx = await getLeadDispatchContext(leadId)
  if (!ctx) return NextResponse.json({ error: "Job not found" }, { status: 404 })

  // Authorize: the owner of the job, or the tech it's assigned to.
  const isOwner = user.account_role === "owner" && ctx.owner_user_id === userId
  const isAssignedTech = user.account_role === "field_tech" && ctx.assigned_tech_id === userId
  if (!isOwner && !isAssignedTech) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    const result = await runSmsPipeline({
      leadId,
      phase,
      techName: isAssignedTech ? user.name : body.techName,
      expectedOwnerUserId: ctx.owner_user_id,
    })
    return NextResponse.json({ data: result })
  } catch (e) {
    console.error("[POST /api/sms/trigger-pipeline] failed:", e)
    return NextResponse.json({ error: "Pipeline failed" }, { status: 500 })
  }
}
