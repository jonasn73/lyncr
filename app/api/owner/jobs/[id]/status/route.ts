// PATCH /api/owner/jobs/[id]/status — owner updates field progress from the dispatch drawer.

import { NextRequest, NextResponse } from "next/server"
import { after } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  getOwnerSchedulerEventById,
  setJobStatusForOwner,
  setLeadDispatchStatus,
} from "@/lib/db"
import {
  sendDispatchEnRouteCustomerSms,
  sendDispatchOnSiteCustomerSms,
} from "@/lib/dispatch-customer-sms"
import { publishOwnerEvent } from "@/lib/realtime/pusher-server"

export const dynamic = "force-dynamic"

/** Field progress + terminal close-out statuses from the Active Job drawer. */
const ALLOWED = new Set([
  "assigned",
  "en_route",
  "arrived",
  "completed",
  "cancelled",
  "unresolved",
  "referred",
])

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, context: RouteContext) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const { id: leadId } = await context.params
  if (!leadId?.trim()) return NextResponse.json({ error: "Missing job id" }, { status: 400 })

  const body = (await req.json().catch(() => ({}))) as { status?: string }
  const status = String(body.status || "").trim()
  if (!ALLOWED.has(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 })
  }

  const previous = await getOwnerSchedulerEventById(userId, leadId.trim())
  if (!previous) return NextResponse.json({ error: "Job not found" }, { status: 404 })

  if (status === "en_route" || status === "arrived" || status === "assigned") {
    if (!previous.assigned_tech_id) {
      return NextResponse.json({ error: "Assign a technician before updating field status" }, { status: 400 })
    }
  }

  try {
    const ok = await setJobStatusForOwner(userId, leadId.trim(), status)
    if (!ok) return NextResponse.json({ error: "Job not found" }, { status: 404 })

    if (status === "en_route" || status === "assigned") {
      await setLeadDispatchStatus(leadId.trim(), "DISPATCHED").catch(() => {})
    }

    await publishOwnerEvent(userId, "job-status-updated", { leadId: leadId.trim(), status }).catch(
      () => {}
    )

    const prevStatus = (previous.job_status ?? "").trim().toLowerCase()
    if (status === "en_route" && prevStatus !== "en_route") {
      after(async () => {
        try {
          await sendDispatchEnRouteCustomerSms({ leadId: leadId.trim(), expectedOwnerUserId: userId })
        } catch (e) {
          console.warn("[owner job status] en_route SMS failed:", e)
        }
      })
    }
    if (status === "arrived" && prevStatus !== "arrived") {
      after(async () => {
        try {
          await sendDispatchOnSiteCustomerSms({ leadId: leadId.trim(), expectedOwnerUserId: userId })
        } catch (e) {
          console.warn("[owner job status] on_site SMS failed:", e)
        }
      })
    }

    const event = await getOwnerSchedulerEventById(userId, leadId.trim())
    return NextResponse.json({ data: { event, status } })
  } catch (e) {
    console.error("[PATCH /api/owner/jobs/[id]/status]", e)
    return NextResponse.json({ error: "Could not update job status" }, { status: 500 })
  }
}
