// POST /api/calls/quick-log — light missed-call note from Activities (no YMM / booking wizard).

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { recordOperatorDisposition } from "@/lib/call-disposition"
import { setCallLogInternalNotes } from "@/lib/db"
import type { LeadDisposition } from "@/lib/db"

type QuickLogOutcome = "callback" | "saved" | "not_a_lead"

function dispositionForOutcome(outcome: QuickLogOutcome): LeadDisposition {
  // Callback / saved note → pending follow-up; wrong number / spam → failed.
  if (outcome === "not_a_lead") return "FAILED"
  return "PENDING_TIME"
}

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const callLogId = String(body.call_log_id ?? "").trim()
  const phone = String(body.phone_number ?? "").trim()
  const purpose = String(body.purpose ?? "").trim()
  const notes = String(body.notes ?? "").trim()
  const customerName = String(body.customer_name ?? "").trim()
  const outcomeRaw = String(body.outcome ?? "saved").trim().toLowerCase()
  const outcome: QuickLogOutcome =
    outcomeRaw === "callback" || outcomeRaw === "not_a_lead" ? outcomeRaw : "saved"

  if (!phone && !callLogId) {
    return NextResponse.json({ error: "phone_number or call_log_id is required" }, { status: 400 })
  }
  if (!purpose && !notes) {
    return NextResponse.json({ error: "Add a purpose or a short note" }, { status: 400 })
  }

  const disposition = dispositionForOutcome(outcome)
  const summaryParts = [
    purpose || null,
    notes || null,
    customerName ? `Name: ${customerName}` : null,
  ].filter(Boolean)
  const summary = summaryParts.join(" — ")

  try {
    const { leadId } = await recordOperatorDisposition({
      userId,
      disposition,
      callLogId: callLogId || null,
      callerNumber: phone || null,
      summary,
      source: "activity_missed_quick_log",
    })

    // Keep the free-text on the call log when we have an id (deploy-safe if column missing).
    if (callLogId && (notes || purpose)) {
      const noteLine = [purpose, notes].filter(Boolean).join(": ")
      await setCallLogInternalNotes(callLogId, noteLine).catch((e) =>
        console.error("[POST /api/calls/quick-log] setCallLogInternalNotes", e)
      )
    }

    return NextResponse.json({
      data: { lead_id: leadId, disposition },
    })
  } catch (e) {
    console.error("[POST /api/calls/quick-log]", e)
    return NextResponse.json({ error: "Could not save call note" }, { status: 500 })
  }
}
