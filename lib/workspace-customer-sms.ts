// Send a customer-facing SMS via Telnyx and log it into sms_messages for the inbox.
// Hard rule: never silently send from another shop’s line.

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
import { resolveWorkspaceSmsSender } from "@/lib/workspace-sms-sender"
import { listAmberControlE164sForOwner } from "@/lib/amber-db"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"

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
 *
 * Shop safety:
 * - Sends only from the job/workspace shop’s line
 * - Multi-shop accounts must pass organizationId (no cross-shop guessing)
 * - Explicit fromE164 from another shop is rejected with a loud error
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

  const sender = await resolveWorkspaceSmsSender(params.ownerUserId, params.organizationId)
  if (!sender.ok) {
    return { ok: false, error: sender.message || "No business line available for customer SMS." }
  }

  const amberSkip = new Set(await listAmberControlE164sForOwner(params.ownerUserId))
  const fromHint = params.fromE164?.trim()
    ? normalizePhoneNumberE164(params.fromE164)
    : ""

  let fromE164 = fromHint || sender.from_e164
  if (fromE164 && amberSkip.has(fromE164)) {
    fromE164 = !amberSkip.has(sender.from_e164) ? sender.from_e164 : ""
  }
  if (!fromE164) {
    return { ok: false, error: "Customer SMS cannot send from the Amber number." }
  }

  // If a From number was forced, it must belong to the same shop — never another business.
  if (fromHint && fromHint !== sender.from_e164) {
    const hintedLine = await getActivePhoneNumberByE164(fromHint)
    const hintedOrg =
      hintedLine?.organization_id && !hintedLine.organization_id.startsWith("legacy-")
        ? hintedLine.organization_id
        : null
    if (!hintedLine || hintedLine.user_id !== params.ownerUserId) {
      console.error("[SMS GUARD] Blocked From number not on this account", {
        ownerUserId: params.ownerUserId,
        fromHint,
        shopId: sender.organization_id,
      })
      return {
        ok: false,
        error: `SMS blocked: ${formatPhoneDisplay(fromHint)} is not an active line on this account.`,
      }
    }
    if (hintedOrg && hintedOrg !== sender.organization_id) {
      console.error("[SMS GUARD] Blocked cross-shop From number", {
        ownerUserId: params.ownerUserId,
        fromHint,
        hintedOrg,
        shopId: sender.organization_id,
      })
      return {
        ok: false,
        error: `SMS blocked: refusing to send from ${formatPhoneDisplay(fromHint)} — that line belongs to a different shop. Sending only from this shop’s line.`,
      }
    }
    // Same shop (or legacy null org on the row) — allow the explicit From.
    fromE164 = fromHint
  }

  const sent = await sendTelnyxSms({
    toE164,
    text,
    userId: params.ownerUserId,
    fromE164,
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
  const orgFromParam = sender.organization_id

  // Final safety net: if the carrier-accepted From maps to another shop, treat as failure signal.
  if (orgFromLine && orgFromLine !== orgFromParam) {
    console.error("[SMS GUARD] Sent From resolved to a different shop than requested", {
      ownerUserId: params.ownerUserId,
      sentFrom: sent.from,
      orgFromLine,
      shopId: orgFromParam,
    })
  }

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
