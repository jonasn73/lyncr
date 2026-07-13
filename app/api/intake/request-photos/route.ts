// POST /api/intake/request-photos — text customer a /upload?t=… link during live intake.

import { NextRequest, NextResponse } from "next/server"
import { getSessionUser } from "@/lib/server-session-user"
import { isReasonablePstnDialString, normalizePhoneNumberE164 } from "@/lib/db"
import { resolveWorkspaceAccountId } from "@/lib/active-operator"
import { createJobPhotoToken } from "@/lib/job-photo-request"
import { sendTelnyxSms } from "@/lib/telnyx-sms"
import { toE164 } from "@/lib/phone-e164"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  // Require a signed-in owner / receptionist.
  const user = await getSessionUser()
  // Block anonymous requests.
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  // Stable account id for token + SMS sender profile.
  const userId = user.id
  // Map receptionist sessions onto the business OWNER for Pusher + storage.
  const accountId = await resolveWorkspaceAccountId(userId)

  // Parse JSON body from the intake button click.
  let body: { phone?: string; call_log_id?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // Normalize caller phone to E.164 for Telnyx.
  const phone =
    normalizePhoneNumberE164(body.phone || "") || toE164(body.phone || "") || ""
  // Reject landlines / junk that cannot receive SMS.
  if (!isReasonablePstnDialString(phone)) {
    return NextResponse.json({ error: "Valid customer phone required" }, { status: 400 })
  }

  // Create a short-lived upload token tied to this call / ticket.
  const created = await createJobPhotoToken({
    ownerUserId: accountId,
    callLogId: body.call_log_id?.trim() || null,
    customerPhone: phone,
  })
  // Surface a clear Neon migration hint when tables are missing.
  if (!created) {
    return NextResponse.json(
      { error: "Could not create photo link. Run scripts/096-job-photo-requests.sql in Neon." },
      { status: 500 }
    )
  }

  // Exact SMS copy from product requirement.
  const text = `Key Squad here! Please click this link to upload photos of your lock or ignition damage so we can accurately quote your parts: ${created.url}`
  // Send via the account's Telnyx number (prefer company account for messaging profile).
  const sent = await sendTelnyxSms({ toE164: phone, text, userId: accountId })
  // Bubble Telnyx / 10DLC failures to the intake toast.
  if (!sent.ok) {
    return NextResponse.json({ error: sent.error || "SMS failed" }, { status: 502 })
  }

  // Return token so the gallery can filter Pusher events for this request.
  return NextResponse.json({ data: { token_id: created.id, url: created.url } })
}
