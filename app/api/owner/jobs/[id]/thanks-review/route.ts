// POST /api/owner/jobs/[id]/thanks-review — send thank-you + review SMS now (Today one-tap).

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getOwnerSchedulerEventById } from "@/lib/db"
import { sendManualThanksReviewSms } from "@/lib/sms-pipeline"

export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, context: RouteContext) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const { id: leadId } = await context.params
  if (!leadId?.trim()) return NextResponse.json({ error: "Missing job id" }, { status: 400 })

  const event = await getOwnerSchedulerEventById(userId, leadId.trim())
  if (!event) return NextResponse.json({ error: "Job not found" }, { status: 404 })

  try {
    // Explicit tap — do not require the auto “Review SMS” toggle.
    const result = await sendManualThanksReviewSms({
      leadId: leadId.trim(),
      expectedOwnerUserId: userId,
      techName: event.assigned_tech_name,
    })
    if (!result.ok && result.skipped) {
      const error =
        result.reason === "no-customer-phone"
          ? "This job has no customer phone number."
          : result.reason === "send-failed"
            ? result.detail?.trim() ||
              "SMS failed to send — check your line and try again."
            : "Could not send thank-you SMS."
      return NextResponse.json(
        { error, reason: result.reason, detail: result.detail ?? null },
        { status: 400 }
      )
    }
    if (!result.ok) {
      return NextResponse.json({ error: "Could not send thank-you SMS." }, { status: 500 })
    }
    return NextResponse.json({
      data: {
        ok: true,
        leadId: leadId.trim(),
        sent: result.sent === true,
      },
    })
  } catch (e) {
    console.error("[POST /api/owner/jobs/[id]/thanks-review]", e)
    return NextResponse.json({ error: "Could not send thank-you SMS." }, { status: 500 })
  }
}
