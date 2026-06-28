// Builds the `<Number url="…">` / `<Sip url="…">` document URL that Telnyx fetches the instant
// the callee answers (owner cell, receptionist cell, or WebRTC browser). The answer webhook
// marks the call answered and broadcasts `call-answered` on the owner dashboard Pusher channel.

import type { ReceptionistBusinessType } from "@/lib/business-type"

export function buildReceptionistAnswerUrl(params: {
  appUrl: string
  /** Optional — omit for owner-only legs (owner CRM still gets the Pusher event). */
  receptionistId?: string | null
  callSid: string
  businessType: ReceptionistBusinessType
  callerNumber?: string | null
  callerName?: string | null
  businessName?: string | null
  /** Optional whisper phrase spoken to the receptionist on answer. */
  whisper?: string | null
}): string {
  const base = params.appUrl.replace(/\/+$/, "")
  const qs = new URLSearchParams()
  if (params.receptionistId?.trim()) qs.set("r", params.receptionistId.trim())
  if (params.callSid) qs.set("cl", params.callSid)
  qs.set("bt", params.businessType)
  if (params.callerNumber) qs.set("from", params.callerNumber)
  if (params.callerName) qs.set("cn", params.callerName)
  if (params.businessName) qs.set("bn", params.businessName)
  if (params.whisper) qs.set("p", params.whisper)
  return `${base}/api/voice/telnyx/receptionist-answer?${qs.toString()}`
}
