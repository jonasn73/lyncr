// Send a customer-facing SMS via Telnyx and log it into sms_messages for the inbox.

import {
  getActivePhoneNumberByE164,
  insertSmsMessage,
  normalizePhoneNumberE164,
} from "@/lib/db"
import {
  sendTelnyxSms,
  type TelnyxSmsErrorType,
} from "@/lib/telnyx-sms"
import type { SmsMessage } from "@/lib/types"

export type WorkspaceCustomerSmsResult =
  | {
      ok: true
      message: SmsMessage | null
      from: string
      to: string
      message_id: string | null
      delivery_warning: string | null
    }
  | {
      ok: false
      error: string
      errorType?: TelnyxSmsErrorType
    }

/**
 * Outbound customer SMS used by the Messages inbox and automations (e.g. textback).
 * Always attempts to persist an outbound row so threads stay two-sided.
 */
export async function sendAndLogWorkspaceCustomerSms(params: {
  ownerUserId: string
  toE164: string
  text: string
  organizationId?: string | null
  fromE164?: string | null
}): Promise<WorkspaceCustomerSmsResult> {
  const toE164 = normalizePhoneNumberE164(params.toE164)
  const text = params.text.trim()
  if (!toE164) return { ok: false, error: "Recipient phone number is required" }
  if (!text) return { ok: false, error: "Message text is required" }

  const fromHint = params.fromE164?.trim()
    ? normalizePhoneNumberE164(params.fromE164)
    : ""

  const sent = await sendTelnyxSms({
    toE164,
    text,
    userId: params.ownerUserId,
    fromE164: fromHint || undefined,
  })

  if (!sent.ok) {
    return { ok: false, error: sent.error, errorType: sent.errorType }
  }

  let line = await getActivePhoneNumberByE164(sent.from)
  if (line && line.user_id !== params.ownerUserId) line = null

  const orgFromLine =
    line?.organization_id && !line.organization_id.startsWith("legacy-")
      ? line.organization_id
      : null
  const orgFromParam =
    params.organizationId?.trim() && !params.organizationId.startsWith("legacy-")
      ? params.organizationId.trim()
      : null

  const message = await insertSmsMessage({
    organization_id: orgFromLine || orgFromParam,
    owner_user_id: params.ownerUserId,
    phone_number_id: line?.id ?? null,
    direction: "outbound",
    from_number: sent.from,
    to_number: sent.to,
    body: text,
    customer_phone: toE164,
    telnyx_message_id: sent.message_id,
    status: sent.delivery_warning ? "accepted_with_warning" : "sent",
  })

  return {
    ok: true,
    message,
    from: sent.from,
    to: sent.to,
    message_id: sent.message_id,
    delivery_warning: sent.delivery_warning,
  }
}
