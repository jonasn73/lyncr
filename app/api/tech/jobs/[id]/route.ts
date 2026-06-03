// ============================================
// PATCH /api/tech/jobs/[id]
// ============================================
// Field tech updates a job's field status (en_route | arrived | completed). Owner-notified live.

import { NextRequest, NextResponse } from "next/server"
import { after } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getOwnerIdForLead, getUser, setJobStatusForTech } from "@/lib/db"
import { publishOwnerEvent } from "@/lib/realtime/pusher-server"
import { runSmsPipeline } from "@/lib/sms-pipeline"

export const dynamic = "force-dynamic"

const ALLOWED = new Set(["en_route", "arrived", "completed", "assigned"])

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user || user.account_role !== "field_tech") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await ctx.params
  const body = (await req.json().catch(() => ({}))) as { status?: string }
  const status = String(body.status || "").trim()
  if (!ALLOWED.has(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 })
  }

  try {
    const ok = await setJobStatusForTech(userId, id, status)
    if (!ok) return NextResponse.json({ error: "Job not found or not assigned to you" }, { status: 404 })

    // Tell the owner dashboard the job moved.
    const ownerId = await getOwnerIdForLead(id)
    if (ownerId) {
      await publishOwnerEvent(ownerId, "job-status-updated", { leadId: id, status }).catch(() => {})
    }

    // Pressing "Start Route" dispatches the customer's "on the way" text (if the owner enabled it).
    if (status === "en_route") {
      after(async () => {
        try {
          await runSmsPipeline({ leadId: id, phase: "route", techName: user.name })
        } catch (e) {
          console.warn("[tech status] route SMS pipeline failed:", e)
        }
      })
    }
    return NextResponse.json({ data: { id, status } })
  } catch (e) {
    console.error("[PATCH /api/tech/jobs/[id]] failed:", e)
    return NextResponse.json({ error: "Could not update job" }, { status: 500 })
  }
}
