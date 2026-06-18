// POST /api/receptionist/intake — receptionist submits the live intake form captured
// during an active call. Saves an AI-lead-style intake under the owner's account and
// fires the SMS lead alert (subject to 10DLC delivery).

import { after } from "next/server"
import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getReceptionistPortalContext } from "@/lib/receptionist-portal-auth"
import { saveCallIntake } from "@/lib/intake-engine"
import { persistLeadAddressFromFields } from "@/lib/geocode"

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
