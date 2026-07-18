// POST /api/intake/request-gps — text customer a secure /track-location link via Telnyx.

import { NextRequest, NextResponse } from "next/server"
import { getSessionUser } from "@/lib/server-session-user"
import { isReasonablePstnDialString, normalizePhoneNumberE164 } from "@/lib/db"
import {
  buildLiveGpsRequestSmsText,
  buildTrackLocationUrl,
  createLiveGpsLocateToken,
} from "@/lib/live-gps-locate"
import { toE164 } from "@/lib/phone-e164"
import { resolveWorkspaceSmsSender } from "@/lib/workspace-sms-sender"
import { sendTelnyxSms } from "@/lib/telnyx-sms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser()
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const userId = user.id

    // Soft-fail when Telnyx is not configured locally / in Vercel (never crash the intake UI).
    if (!process.env.TELNYX_API_KEY?.trim()) {
      console.warn("Telnyx SMS skipped: Missing local environment variables")
      return NextResponse.json(
        {
          error: "Telnyx SMS skipped: Missing local environment variables (TELNYX_API_KEY)",
          missing: ["TELNYX_API_KEY"],
        },
        { status: 503 }
      )
    }

    let body: { phone?: string; call_log_id?: string; organization_id?: string | null; jobId?: string }
    try {
      body = (await req.json()) as typeof body
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }

    const phone =
      normalizePhoneNumberE164(body.phone || "") || toE164(body.phone || "") || ""
    if (!isReasonablePstnDialString(phone)) {
      return NextResponse.json({ error: "Valid customer phone required" }, { status: 400 })
    }

    // Prefer this workspace's active Telnyx DID; sendTelnyxSms also falls back to env DIDs.
    const sender = await resolveWorkspaceSmsSender(userId, body.organization_id ?? null)
    const fromE164 = sender.ok ? normalizePhoneNumberE164(sender.from_e164) : null

    const created = await createLiveGpsLocateToken({
      ownerUserId: userId,
      callLogId: body.call_log_id?.trim() || null,
      customerPhone: phone,
    })
    if (!created) {
      return NextResponse.json(
        { error: "Could not create locate link. Run scripts/093-live-gps-locate.sql in Neon." },
        { status: 500 }
      )
    }

    const jobId = body.jobId?.trim() || body.call_log_id?.trim() || created.id
    const trackUrl = buildTrackLocationUrl(created.id, jobId)
    const text = buildLiveGpsRequestSmsText(trackUrl)

    const sent = await sendTelnyxSms({
      toE164: phone,
      text,
      userId,
      fromE164: fromE164 || undefined,
    })

    if (!sent.ok) {
      console.error("[request-gps] Telnyx SMS failed:", {
        to: phone,
        from: fromE164,
        detail: sent.error,
      })
      // When workspace sender failed and sendTelnyxSms also failed, surface the workspace hint.
      const error =
        !sender.ok && /missing local environment|no telnyx sms sender/i.test(sent.error)
          ? sender.message
          : sent.error
      return NextResponse.json(
        {
          error,
          from: fromE164,
          missing: /TELNYX_PHONE_NUMBER|environment variables/i.test(sent.error)
            ? ["TELNYX_PHONE_NUMBER", "TELNYX_MESSAGING_FROM_E164"]
            : undefined,
        },
        { status: 502 }
      )
    }

    return NextResponse.json({
      data: {
        token_id: created.id,
        url: trackUrl,
        from: sent.from,
        message_id: sent.message_id,
        delivery_warning: sent.delivery_warning,
      },
    })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    console.error("[request-gps] unexpected failure:", detail)
    return NextResponse.json(
      { error: "Could not send GPS text. Check server logs for details." },
      { status: 500 }
    )
  }
}
