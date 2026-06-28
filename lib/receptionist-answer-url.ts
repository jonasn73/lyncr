// Builds the `<Number url="…">` / `<Sip url="…">` document URL that Telnyx fetches the instant
// the callee answers (owner cell, receptionist cell, or WebRTC browser). The answer webhook
// marks the call answered and broadcasts `call-answered` on the owner dashboard Pusher channel.

import type { ReceptionistBusinessType } from "@/lib/business-type"

export function buildReceptionistAnswerUrl(params: {
  appUrl: string
  /** Business owner user id — used if the call log row is not written yet. */
  ownerUserId: string
  /** Business DID (E.164) — stored on the call log when backfilling. */
  toNumber?: string | null
  /** Optional — omit for owner-only legs (owner CRM still gets the Pusher event). */
  receptionistId?: string | null
  callSid: string
  /** Neon call_logs.id — lets the answer webhook push Pusher before any DB read. */
  callLogId?: string | null
  businessType: ReceptionistBusinessType
  callerNumber?: string | null
  callerName?: string | null
  businessName?: string | null
  /** Optional whisper phrase spoken to the receptionist on answer. */
  whisper?: string | null
}): string {
  const base = params.appUrl.replace(/\/+$/, "")
  const qs = new URLSearchParams()
  qs.set("u", params.ownerUserId.trim())
  if (params.toNumber?.trim()) qs.set("to", params.toNumber.trim())
  if (params.receptionistId?.trim()) qs.set("r", params.receptionistId.trim())
  if (params.callSid) qs.set("cl", params.callSid)
  if (params.callLogId?.trim()) qs.set("lid", params.callLogId.trim())
  qs.set("bt", params.businessType)
  if (params.callerNumber) qs.set("from", params.callerNumber)
  if (params.callerName) qs.set("cn", params.callerName)
  if (params.businessName) qs.set("bn", params.businessName)
  if (params.whisper) qs.set("p", params.whisper)
  return `${base}/api/voice/telnyx/receptionist-answer?${qs.toString()}`
}
