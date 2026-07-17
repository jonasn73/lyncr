// ============================================
// POST /api/owner/jobs/assign
// ============================================
// Owner assigns (or clears) a field tech on a booked job. Parameterized SQL update + a real-time
// push to that tech's device so the job appears instantly on their console.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { assignJobToTech, listFieldTechnicians } from "@/lib/db"
import { publishTechnicianEvent } from "@/lib/realtime/pusher-server"
import { sendTechJobAssignedSms } from "@/lib/tech-job-assigned-sms"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { leadId?: string; techUserId?: string | null }
  const leadId = String(body.leadId || "").trim()
  const techUserId = body.techUserId ? String(body.techUserId).trim() : null
  if (!leadId) return NextResponse.json({ error: "leadId is required" }, { status: 400 })

  // If assigning, the tech must belong to this owner's active roster.
  if (techUserId) {
    const roster = await listFieldTechnicians(userId)
    const match = roster.find((t) => t.portal_user_id === techUserId && t.is_active)
    if (!match) {
      return NextResponse.json({ error: "Unknown or inactive technician" }, { status: 400 })
    }
  }

  try {
    const ok = await assignJobToTech(userId, leadId, techUserId)
    if (!ok) return NextResponse.json({ error: "Job not found" }, { status: 404 })

    if (techUserId) {
      // Push the job onto the tech's device. The customer "on the way" text fires later, when the
      // tech actually presses Start Route (EN_ROUTE) — so we never text before they're moving.
      await publishTechnicianEvent(techUserId, "job-assigned", { leadId }).catch(() => {})
      // Immediate Telnyx SMS with vehicle + REQUIRED PART (TI SKU).
      const sms = await sendTechJobAssignedSms({
        ownerUserId: userId,
        leadId,
        techUserId,
      }).catch((e) => {
        console.warn("[POST /api/owner/jobs/assign] tech SMS failed:", e)
        return { ok: false as const, reason: "send-failed" }
      })
      if (!sms.ok) {
        console.warn(`[POST /api/owner/jobs/assign] tech SMS skipped: ${sms.reason}`)
      }
    }
    return NextResponse.json({ data: { leadId, techUserId } })
  } catch (e) {
    console.error("[POST /api/owner/jobs/assign] failed:", e)
    return NextResponse.json({ error: "Could not assign job" }, { status: 500 })
  }
}
