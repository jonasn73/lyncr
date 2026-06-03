// ============================================
// POST /api/receptionist/log-job
// ============================================
// An operator submits a job disposition at the end of a call. We persist it as an ai_leads row
// under the owner's account (carrying the operator's notes), stamp the disposition, and broadcast
// an alert to the owner:
//   - BOOKED          → dispatch_status = 'pending_review'
//   - PRICE_REJECTED  → is_salvageable = true (surfaced in the owner's Lyncr Lead Salvage queue)
//
// The disposition keys are written into ai_leads.collected (JSONB) so the owner feeds work even
// before scripts/058 runs; applyLeadDisposition additionally fills the indexed columns when present.

import { after } from "next/server"
import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getReceptionistPortalContext } from "@/lib/receptionist-portal-auth"
import { saveCallIntake } from "@/lib/intake-engine"
import { applyLeadDisposition, type LeadDisposition } from "@/lib/db"
import { dispatchStateFor } from "@/lib/call-disposition"
import { publishOwnerEvent } from "@/lib/realtime/pusher-server"

type LogJobBody = {
  callLogId?: string
  status?: string
  businessType?: string
  callerNumber?: string | null
  callerName?: string | null
  summary?: string | null
  fields?: Record<string, unknown>
}

function normalizeStatus(raw: unknown): LeadDisposition | null {
  const v = String(raw ?? "").trim().toUpperCase()
  return v === "BOOKED" || v === "PRICE_REJECTED" ? v : null
}

function intentSlugFor(businessType: string): string {
  switch (businessType) {
    case "locksmith":
      return "automotive_akl"
    case "detailing":
      return "auto_detailing"
    case "auto_repair":
      return "auto_repair"
    default:
      return "general_intake"
  }
}

export async function POST(req: NextRequest) {
  const portalUserId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!portalUserId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const ctx = await getReceptionistPortalContext(portalUserId)
    if (!ctx) {
      return NextResponse.json({ error: "Receptionist portal access required" }, { status: 403 })
    }

    const body = (await req.json().catch(() => ({}))) as LogJobBody
    const status = normalizeStatus(body.status)
    if (!status) {
      return NextResponse.json(
        { error: "status must be 'BOOKED' or 'PRICE_REJECTED'" },
        { status: 400 }
      )
    }

    const businessType = (body.businessType ?? "generic").toString()
    const fields = body.fields && typeof body.fields === "object" ? body.fields : {}
    const isBooked = status === "BOOKED"
    const { dispatch_status, is_salvageable } = dispatchStateFor(status)
    const summary = body.summary?.trim() || `Job ${status.toLowerCase()} by ${ctx.receptionist.name}.`

    const result = await saveCallIntake({
      user_id: ctx.owner_user_id,
      caller_e164: body.callerNumber ?? null,
      intent_slug: intentSlugFor(businessType),
      collected: {
        ...fields,
        business_type: businessType,
        captured_by_receptionist_id: ctx.receptionist.id,
        captured_by_name: ctx.receptionist.name,
        source: "receptionist_log_job",
        disposition: status,
        dispatch_status,
        is_salvageable,
        ...(body.callLogId ? { call_log_id: body.callLogId } : {}),
      },
      summary,
      vapi_call_id: body.callLogId ? `${body.callLogId}-log-job` : null,
    })

    // Fill indexed columns when scripts/058 is applied (no-op otherwise).
    await applyLeadDisposition(result.id, { disposition: status, dispatch_status, is_salvageable })

    // Broadcast to the owner without delaying the operator's response.
    after(async () => {
      try {
        await publishOwnerEvent(ctx.owner_user_id, isBooked ? "job-booked" : "lead-salvageable", {
          leadId: result.id,
          disposition: status,
          businessName: ctx.business_name,
          callerNumber: body.callerNumber ?? null,
          callerName: body.callerName ?? null,
          summary,
          createdAt: new Date().toISOString(),
        })
      } catch (e) {
        console.error("[receptionist/log-job] owner broadcast failed:", e)
      }
    })

    return NextResponse.json({
      data: {
        lead_id: result.id,
        disposition: status,
        dispatch_status,
        is_salvageable,
        sms_sent: result.sms_sent,
      },
    })
  } catch (error) {
    console.error("[lyncr] receptionist log-job:", error)
    return NextResponse.json({ error: "Failed to log job" }, { status: 500 })
  }
}
