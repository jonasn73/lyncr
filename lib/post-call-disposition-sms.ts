// ============================================
// Post-call outcome-code SMS to the receptionist's cell
// ============================================
// Fired from the Telnyx call-status webhook when a forwarded call ends. If the call was answered by
// a receptionist on a (SMS-capable) cell line, we text them an outcome-code prompt and stash a
// pending_sms_dispositions row so their numeric reply maps back to this exact call.

import {
  createPendingSmsDisposition,
  getCallCellHandoffInfo,
  getReceptionist,
  getUser,
  normalizePhoneNumberE164,
  isReasonablePstnDialString,
} from "@/lib/db"
import { sendTelnyxSms } from "@/lib/telnyx-sms"

const TERMINAL_ANSWERED = new Set(["completed"])

function buildPrompt(businessName: string): string {
  return `Lyncr System: Call ended for ${businessName}. Reply with outcome code: 1 (Booked), 2 (Pending Time), 3 (Price Rejected), 4 (Failed).`
}

/**
 * Best-effort: text the answering receptionist an outcome-code prompt after a completed call.
 * Idempotent per call (the pending row has a unique provider_call_sid), and a safe no-op when the
 * call was not receptionist-handled, the agent has no cell number, or SMS is unavailable.
 */
export async function maybeSendPostCallDispositionSms(callSid: string, callStatus: string): Promise<void> {
  const status = callStatus.trim().toLowerCase()
  if (!TERMINAL_ANSWERED.has(status)) return

  const info = await getCallCellHandoffInfo(callSid)
  if (!info) return
  if (!info.routed_to_receptionist_id) return // not routed to a known receptionist
  if (!info.answered) return // never actually connected to a human

  const receptionist = await getReceptionist(info.routed_to_receptionist_id)
  const rawPhone = receptionist?.phone?.trim() || ""
  if (!rawPhone) return // WEB-only / no cell line → nothing to text
  const cellE164 = normalizePhoneNumberE164(rawPhone)
  if (!isReasonablePstnDialString(cellE164)) return

  const user = await getUser(info.user_id)
  const businessName = user?.business_name?.trim() || user?.name?.trim() || "your business"

  // Reserve the prompt first (unique provider_call_sid) so a Telnyx retry never double-texts.
  const pendingId = await createPendingSmsDisposition({
    userId: info.user_id,
    callLogId: info.id,
    providerCallSid: callSid,
    receptionistId: receptionist?.id ?? info.routed_to_receptionist_id,
    receptionistName: receptionist?.name ?? null,
    receptionistPhoneE164: cellE164,
    callerNumber: info.from_number ?? null,
    businessName,
  })
  if (!pendingId) return // already prompted for this call (or table not migrated yet)

  const sent = await sendTelnyxSms({ toE164: cellE164, text: buildPrompt(businessName), userId: info.user_id })
  if (!sent.ok) {
    console.warn(`[post-call-sms] outcome prompt not sent to ${cellE164}: ${sent.error}`)
  }
}
