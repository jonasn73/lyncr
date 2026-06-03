// ============================================
// POST /api/webhooks/telnyx/messaging
// ============================================
// Telnyx Messaging webhook. Handles inbound SMS (message.received) — specifically a receptionist
// replying to the post-call outcome prompt with 1/2/3/4. We map the digit to our disposition ENUM,
// stamp the matching call log, and broadcast to the owner exactly like the in-app dashboard button.
// Delivery-status events (message.sent / message.finalized / …) are just acked.

import { after } from "next/server"
import { NextRequest, NextResponse } from "next/server"
import {
  findOpenPendingSmsDispositionByPhone,
  resolvePendingSmsDisposition,
  normalizePhoneNumberE164,
} from "@/lib/db"
import {
  parseDispositionCode,
  recordOperatorDisposition,
  DISPOSITION_LABEL,
} from "@/lib/call-disposition"
import { sendTelnyxSms } from "@/lib/telnyx-sms"

export const runtime = "nodejs"

type TelnyxMessagingWebhook = {
  data?: {
    event_type?: string
    payload?: {
      from?: { phone_number?: string }
      text?: string
    }
  }
}

const ACK = NextResponse.json({ ok: true })

export async function POST(req: NextRequest) {
  let body: TelnyxMessagingWebhook | null = null
  try {
    body = (await req.json()) as TelnyxMessagingWebhook
  } catch {
    return ACK // Telnyx only needs a 2xx.
  }

  // Only inbound texts carry an operator reply; everything else is a delivery receipt.
  if (body?.data?.event_type !== "message.received") return ACK

  const fromRaw = body.data.payload?.from?.phone_number?.trim() || ""
  const text = body.data.payload?.text?.trim() || ""
  const disposition = parseDispositionCode(text)
  if (!fromRaw || !disposition) return ACK // no number / no 1-4 code → ignore quietly

  const fromE164 = normalizePhoneNumberE164(fromRaw)

  // Do the DB writes + broadcast after returning 200 so Telnyx isn't kept waiting.
  after(async () => {
    try {
      const pending = await findOpenPendingSmsDispositionByPhone(fromE164)
      if (!pending) {
        console.warn(`[sms-reply] no open outcome prompt for ${fromE164} — ignoring "${text}"`)
        return
      }

      await recordOperatorDisposition({
        userId: pending.user_id,
        disposition,
        providerCallSid: pending.provider_call_sid,
        callLogId: pending.call_log_id,
        callerNumber: pending.caller_number,
        businessName: pending.business_name,
        operatorName: pending.receptionist_name,
        receptionistId: pending.receptionist_id,
        source: "sms_reply",
      })
      await resolvePendingSmsDisposition(pending.id, disposition)

      // Confirm back to the operator (best-effort; outbound, so it never re-triggers this webhook).
      const confirm = `Lyncr System: Outcome saved — ${DISPOSITION_LABEL[disposition]}. Thanks!`
      const sent = await sendTelnyxSms({ toE164: fromE164, text: confirm, userId: pending.user_id })
      if (!sent.ok) console.warn(`[sms-reply] confirmation not sent to ${fromE164}: ${sent.error}`)
    } catch (e) {
      console.error("[sms-reply] failed to process reply:", e)
    }
  })

  return ACK
}
