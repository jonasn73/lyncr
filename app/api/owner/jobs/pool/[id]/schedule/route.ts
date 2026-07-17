// POST /api/owner/jobs/pool/[id]/schedule — drop hopper job onto calendar + assign tech

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { listFieldTechnicians, schedulePoolJobAndAssign } from "@/lib/db"
import { publishOwnerEvent, publishTechnicianEvent } from "@/lib/realtime/pusher-server"
import { sendTechJobAssignedSms } from "@/lib/tech-job-assigned-sms"

export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, context: RouteContext) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const { id: leadId } = await context.params
  if (!leadId?.trim()) return NextResponse.json({ error: "Missing job id" }, { status: 400 })

  const body = (await req.json().catch(() => ({}))) as {
    scheduled_at?: string
    assigned_tech_id?: string
  }
  const scheduledRaw = String(body.scheduled_at ?? "").trim()
  const techUserId = String(body.assigned_tech_id ?? "").trim()
  if (!scheduledRaw || Number.isNaN(Date.parse(scheduledRaw))) {
    return NextResponse.json({ error: "scheduled_at is required" }, { status: 400 })
  }
  if (!techUserId) {
    return NextResponse.json({ error: "assigned_tech_id is required" }, { status: 400 })
  }

  const roster = await listFieldTechnicians(userId)
  const tech = roster.find((t) => t.portal_user_id === techUserId && t.is_active)
  if (!tech?.portal_user_id) {
    return NextResponse.json({ error: "Unknown or inactive technician" }, { status: 400 })
  }

  try {
    const event = await schedulePoolJobAndAssign({
      ownerUserId: userId,
      leadId: leadId.trim(),
      scheduledAtIso: new Date(scheduledRaw).toISOString(),
      techUserId: tech.portal_user_id,
      techName: tech.name,
    })
    if (!event) return NextResponse.json({ error: "Job not found or already assigned" }, { status: 404 })

    await publishTechnicianEvent(tech.portal_user_id, "job-assigned", { leadId: leadId.trim() }).catch(() => {})
    await publishOwnerEvent(userId, "job-assigned", {
      leadId: leadId.trim(),
      techUserId: tech.portal_user_id,
    }).catch(() => {})
    const sms = await sendTechJobAssignedSms({
      ownerUserId: userId,
      leadId: leadId.trim(),
      techUserId: tech.portal_user_id,
    }).catch((e) => {
      console.warn("[POST /api/owner/jobs/pool/[id]/schedule] tech SMS failed:", e)
      return { ok: false as const, reason: "send-failed" }
    })
    if (!sms.ok) {
      console.warn(`[POST /api/owner/jobs/pool/[id]/schedule] tech SMS skipped: ${sms.reason}`)
    }
    return NextResponse.json({ data: { event } })
  } catch (e) {
    console.error("[POST /api/owner/jobs/pool/[id]/schedule]", e)
    return NextResponse.json({ error: "Failed to schedule job" }, { status: 500 })
  }
}
