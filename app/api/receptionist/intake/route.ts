// POST /api/receptionist/intake — receptionist submits the live intake form captured
// during an active call. Saves an AI-lead-style intake under the owner's account and
// fires the SMS lead alert (subject to 10DLC delivery).
//
// It then promotes that same row into the scheduler hopper, so a call SHE takes lands
// where a call the OWNER takes lands. Before this, her intake dead-ended: it wrote a lead
// nobody could act on (the one conversion route, /api/ai-leads/[id]/convert, has no call
// site in either console), so the owner had to re-key the job by hand.
//
// It reuses the owner's own createUnassignedJobFromIntake with `existingLeadId`, which
// UPDATEs her lead rather than inserting a second one — same record shape, same hopper
// flags, same customer upsert, and her lead-alert SMS outcome is left untouched.

import { after } from "next/server"
import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getReceptionistPortalContext } from "@/lib/receptionist-portal-auth"
import { saveCallIntake } from "@/lib/intake-engine"
import { createUnassignedJobFromIntake } from "@/lib/create-intake-job"
import { listOrganizationsForOwner } from "@/lib/db"
import { persistLeadAddressFromFields } from "@/lib/geocode-persist"

/** Read one intake field as a trimmed string — the form serializes everything loosely. */
function fieldText(fields: Record<string, unknown>, key: string): string {
  const raw = fields[key]
  return raw == null ? "" : String(raw).trim()
}

type IntakeBody = {
  callLogId?: string
  businessType?: string
  callerNumber?: string | null
  callerName?: string | null
  summary?: string | null
  fields?: Record<string, unknown>
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

    const body = (await req.json().catch(() => ({}))) as IntakeBody
    const businessType = (body.businessType ?? "generic").toString()
    const fields = body.fields && typeof body.fields === "object" ? body.fields : {}

    const intentSlug =
      businessType === "locksmith"
        ? "automotive_akl"
        : businessType === "detailing"
          ? "auto_detailing"
          : businessType === "auto_repair"
            ? "auto_repair"
            : "general_intake"

    const result = await saveCallIntake({
      user_id: ctx.owner_user_id,
      caller_e164: body.callerNumber ?? null,
      intent_slug: intentSlug,
      collected: {
        ...fields,
        business_type: businessType,
        captured_by_receptionist_id: ctx.receptionist.id,
        captured_by_name: ctx.receptionist.name,
        source: "receptionist_live_intake",
        ...(body.callLogId ? { call_log_id: body.callLogId } : {}),
      },
      summary: body.summary?.trim() || `Live intake captured by ${ctx.receptionist.name}.`,
      vapi_call_id: body.callLogId ? `${body.callLogId}-live-intake` : null,
    })

    // Promote the lead she just captured into the scheduler hopper — the same record the
    // owner's answered-call intake produces. Best-effort on purpose: a call is in progress
    // and a booking that cannot be built (no name, unusable number) must never cost her the
    // intake she already typed. The lead still stands, exactly as it did before.
    let hopperJobCreated = false
    try {
      const jobAddress = fieldText(fields, "job_address")
      const callerName = body.callerName?.trim() || fieldText(fields, "customer_name")
      const callerNumber = body.callerNumber?.trim() || ""

      // The hopper filters by workspace, so a null org would file the job out of sight.
      let organizationId: string | null = null
      try {
        const orgs = await listOrganizationsForOwner(ctx.owner_user_id)
        organizationId = (orgs.find((o) => o.is_default) ?? orgs[0])?.id ?? null
      } catch {
        /* single-workspace owners have no org rows — null is correct there */
      }

      await createUnassignedJobFromIntake({
        ownerUserId: ctx.owner_user_id,
        organizationId,
        // Updates the row saveCallIntake just wrote instead of inserting a duplicate.
        existingLeadId: result.id,
        callLogId: body.callLogId ?? null,
        callerE164: callerNumber,
        customerName: callerName || callerNumber || "Caller",
        addressLine1: jobAddress || null,
        notes: fieldText(fields, "job_notes") || null,
        vehicleYear: fieldText(fields, "vehicle_year") || null,
        vehicleMake: fieldText(fields, "vehicle_make") || null,
        vehicleModel: fieldText(fields, "vehicle_model") || null,
        vehicleVin: fieldText(fields, "vin") || null,
        jobType: fieldText(fields, "job_type") || null,
        // No street yet means it belongs in the hopper as a callback, not as a dispatch
        // with an invented address.
        pendingCallback: !jobAddress,
        // She has never texted the caller on submit, and starting now would be a new
        // outbound message the owner did not ask for. Stage 2 can surface the draft.
        deferCustomerSms: true,
        intakeSource: "receptionist_live_intake",
      })
      hopperJobCreated = true
    } catch (e) {
      console.error("[receptionist/intake] hopper job promotion failed:", e)
    }

    after(async () => {
      try {
        await persistLeadAddressFromFields(result.id, fields)
      } catch (e) {
        console.error("[receptionist/intake] address persist failed:", e)
      }
    })

    return NextResponse.json({
      data: {
        intake_id: result.id,
        hopper_job_created: hopperJobCreated,
        sms_sent: result.sms_sent,
        sms_error: result.sms_error,
        sms_to: result.sms_to,
      },
    })
  } catch (error) {
    console.error("[lyncr] receptionist live intake:", error)
    return NextResponse.json({ error: "Failed to save intake" }, { status: 500 })
  }
}
