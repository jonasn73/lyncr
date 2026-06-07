// Handle Telnyx message.received — operator disposition replies + customer thread storage.

import {
  findOpenPendingSmsDispositionByPhone,
  getActivePhoneNumberByE164,
  getDefaultOrganizationForOwner,
  insertSmsMessage,
  normalizePhoneNumberE164,
  resolvePendingSmsDisposition,
} from "@/lib/db"
import {
  parseDispositionCode,
  recordOperatorDisposition,
  DISPOSITION_LABEL,
} from "@/lib/call-disposition"
import { sendTelnyxSms } from "@/lib/telnyx-sms"

export type TelnyxMessagingWebhook = {
  data?: {
    event_type?: string
    id?: string
    payload?: {
      id?: string
      from?: { phone_number?: string }
      to?: { phone_number?: string }[] | { phone_number?: string }
      text?: string
    }
  }
}

function extractToE164(payload: TelnyxMessagingWebhook["data"]): string {
  const to = payload?.payload?.to
  if (Array.isArray(to)) {
    const first = to[0]?.phone_number?.trim()
    return first ? normalizePhoneNumberE164(first) : ""
  }
  if (to && typeof to === "object" && "phone_number" in to) {
    const pn = (to as { phone_number?: string }).phone_number?.trim()
    return pn ? normalizePhoneNumberE164(pn) : ""
  }
  return ""
}

/** Process one inbound SMS after the webhook returns 200. */
export async function processInboundTelnyxMessage(body: TelnyxMessagingWebhook): Promise<void> {
  if (body?.data?.event_type !== "message.received") return

  const fromRaw = body.data.payload?.from?.phone_number?.trim() || ""
  const toRaw = extractToE164(body.data)
  const text = body.data.payload?.text?.trim() || ""
  if (!fromRaw || !toRaw) return

  const fromE164 = normalizePhoneNumberE164(fromRaw)
  const toE164 = normalizePhoneNumberE164(toRaw)
  const telnyxMessageId =
    body.data.payload?.id?.trim() || body.data.id?.trim() || null

  const disposition = parseDispositionCode(text)
  if (disposition) {
    const pending = await findOpenPendingSmsDispositionByPhone(fromE164)
    if (pending) {
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
      const confirm = `Lyncr System: Outcome saved — ${DISPOSITION_LABEL[disposition]}. Thanks!`
      const sent = await sendTelnyxSms({ toE164: fromE164, text: confirm, userId: pending.user_id })
      if (!sent.ok) console.warn(`[sms-reply] confirmation not sent to ${fromE164}: ${sent.error}`)
      return
    }
  }

  const line = await getActivePhoneNumberByE164(toE164)
  if (!line) {
    console.warn(`[sms-inbound] no active line for ${toE164} — ignoring message from ${fromE164}`)
    return
  }

  let orgId =
    line.organization_id && !line.organization_id.startsWith("legacy-") ? line.organization_id : null
  if (!orgId) {
    const def = await getDefaultOrganizationForOwner(line.user_id)
    if (def && !def.id.startsWith("legacy-")) orgId = def.id
  }

  const saved = await insertSmsMessage({
    organization_id: orgId,
    owner_user_id: line.user_id,
    phone_number_id: line.id,
    direction: "inbound",
    from_number: fromE164,
    to_number: toE164,
    body: text,
    customer_phone: fromE164,
    telnyx_message_id: telnyxMessageId,
    status: "received",
  })

  if (!saved) {
    console.warn(
      `[sms-inbound] could not persist message (run scripts/069-sms-messages.sql?) — ${fromE164} → ${toE164}`
    )
  }
}
