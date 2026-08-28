// ============================================
// PATCH /api/tech/jobs/[id]
// ============================================
// Field tech updates a job's field status (en_route | arrived | completed). Owner-notified live.

import { NextRequest, NextResponse } from "next/server"
import { after } from "next/server"
import { resolveActor } from "@/lib/actor"
import { getOwnerIdForLead, getUser, setJobStatusForTech } from "@/lib/db"
import { publishOwnerEvent } from "@/lib/realtime/pusher-server"
import {
  sendDispatchEnRouteCustomerSms,
  sendDispatchOnSiteCustomerSms,
  sendDispatchPausedPartsCustomerSms,
  sendDispatchPausedWaitCustomerSms,
} from "@/lib/dispatch-customer-sms"

export const dynamic = "force-dynamic"

const ALLOWED = new Set([
  "en_route",
  "arrived",
  "paused_wait",
  "paused_parts",
  "work_complete",
  "completed",
  "assigned",
])

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const actor = await resolveActor(req.headers.get("cookie"), { allowFieldTech: true })
  if (!actor || actor.actorRole !== "field_tech") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  // Acts as the tech, not the business — these rows are scoped to them.
  const userId = actor.actingUserId

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

    if (status === "en_route") {
      after(async () => {
        try {
          const ownerId = await getOwnerIdForLead(id)
          await sendDispatchEnRouteCustomerSms({
            leadId: id,
            expectedOwnerUserId: ownerId ?? undefined,
          })
        } catch (e) {
          console.warn("[tech status] en_route SMS failed:", e)
        }
      })
    }
    if (status === "arrived") {
      after(async () => {
        try {
          const ownerId = await getOwnerIdForLead(id)
          await sendDispatchOnSiteCustomerSms({
            leadId: id,
            expectedOwnerUserId: ownerId ?? undefined,
          })
        } catch (e) {
          console.warn("[tech status] on_site SMS failed:", e)
        }
      })
    }
    if (status === "paused_wait") {
      after(async () => {
        try {
          const ownerId = await getOwnerIdForLead(id)
          await sendDispatchPausedWaitCustomerSms({
            leadId: id,
            expectedOwnerUserId: ownerId ?? undefined,
          })
        } catch (e) {
          console.warn("[tech status] paused_wait SMS failed:", e)
        }
      })
    }
    if (status === "paused_parts") {
      after(async () => {
        try {
          const ownerId = await getOwnerIdForLead(id)
          await sendDispatchPausedPartsCustomerSms({
            leadId: id,
            expectedOwnerUserId: ownerId ?? undefined,
          })
        } catch (e) {
          console.warn("[tech status] paused_parts SMS failed:", e)
        }
      })
    }
    // Tech marks job done → Latest job_finished until owner sends Thanks + review.
    if (status === "completed" || status === "work_complete") {
      after(async () => {
        try {
          const ownerId = await getOwnerIdForLead(id)
          if (!ownerId) return
          const { getOwnerSchedulerEventById } = await import("@/lib/db")
          const event = await getOwnerSchedulerEventById(ownerId, id)
          // Skip if review SMS already went out (job would not stay in Latest).
          if (event?.review_sms_sent_at) return
          const { notifyOwnerLatestNeedsAttention } = await import("@/lib/latest-attention-sms")
          await notifyOwnerLatestNeedsAttention({
            userId: ownerId,
            event: "job_finished",
            jobId: id,
            customerPhone: event?.customer_phone ?? null,
            customerName: event?.customer_name ?? null,
          })
        } catch (e) {
          console.warn("[tech status] latest attention SMS failed:", e)
        }
      })
    }
    return NextResponse.json({ data: { id, status } })
  } catch (e) {
    console.error("[PATCH /api/tech/jobs/[id]] failed:", e)
    return NextResponse.json({ error: "Could not update job" }, { status: 500 })
  }
}
