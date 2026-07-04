// POST /api/calls/manual — stub call_logs row for walk-in / manual dispatch intake.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { insertManualIntakeCallLog } from "@/lib/manual-call-log"

export const dynamic = "force-dynamic"

type ManualCallBody = {
  phone_number?: string | null
  technician_id?: string | null
  to_number?: string | null
  caller_name?: string | null
  metadata?: Record<string, unknown> | null
}

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  try {
    const body = (await req.json().catch(() => ({}))) as ManualCallBody
    const phone = String(body.phone_number ?? "").trim()
    if (!phone) return NextResponse.json({ error: "phone_number is required" }, { status: 400 })

    const metadata =
      body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? body.metadata
        : {}

    const result = await insertManualIntakeCallLog({
      ownerUserId: userId,
      phoneNumber: phone,
      toNumber: body.to_number?.trim() || null,
      callerName: body.caller_name?.trim() || null,
      technicianUserId: body.technician_id?.trim() || null,
      metadata,
    })

    return NextResponse.json({
      data: {
        call_log_id: result.call_log_id,
        provider_call_sid: result.provider_call_sid,
        direction: "manual_intake",
        source: result.intake_source,
        call_type: result.call_type,
      },
    })
  } catch (e) {
    console.error("[POST /api/calls/manual]", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not create manual call log." },
      { status: 400 }
    )
  }
}
