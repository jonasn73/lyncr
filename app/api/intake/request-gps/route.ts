// POST /api/intake/request-gps — text customer a /locate?c=… link during live intake.

import { NextRequest, NextResponse } from "next/server"
import { getSessionUser } from "@/lib/server-session-user"
import { isReasonablePstnDialString, normalizePhoneNumberE164 } from "@/lib/db"
import { createLiveGpsLocateToken } from "@/lib/live-gps-locate"
import { sendTelnyxSms } from "@/lib/telnyx-sms"
import { toE164 } from "@/lib/phone-e164"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = user.id

  let body: { phone?: string; call_log_id?: string }
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

  const text = `Key Squad here — tap this secure link to share your live GPS so we can find you faster: ${created.url}`
  const sent = await sendTelnyxSms({ toE164: phone, text, userId })
  if (!sent.ok) {
    return NextResponse.json({ error: sent.error || "SMS failed" }, { status: 502 })
  }

  return NextResponse.json({ data: { token_id: created.id, url: created.url } })
}
