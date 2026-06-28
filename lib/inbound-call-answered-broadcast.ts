// Single hub: carrier "leg answered" webhook → owner-{userId} Pusher `call-answered`.
// Used by TeXML <Number url> / <Sip url>, Telnyx status callbacks, and Call Control bridge.

import { broadcastCallAnsweredBySid } from "@/lib/call-telemetry-realtime"
import { recordCallStatusEvent } from "@/lib/db"

export type NotifyOwnerInboundCallAnsweredParams = {
  /** Telnyx CallSid / call_logs.provider_call_sid */
  providerCallSid: string
  occurredAtIso?: string
}

/**
 * Mark the inbound call answered in Neon and push `call-answered` on the owner dashboard channel.
 * Safe to call more than once — the client dedupes by call_log id.
 */
export async function notifyOwnerInboundCallAnswered(
  params: NotifyOwnerInboundCallAnsweredParams
): Promise<{ broadcast: boolean }> {
  const sid = params.providerCallSid.trim()
  if (!sid) return { broadcast: false }

  const occurredAt = params.occurredAtIso ?? new Date().toISOString()
  try {
    await recordCallStatusEvent(sid, "answered", 0, occurredAt)
  } catch (e) {
    console.warn("[inbound-call-answered] recordCallStatusEvent failed:", e)
  }

  try {
    await broadcastCallAnsweredBySid(sid)
    return { broadcast: true }
  } catch (e) {
    console.warn("[inbound-call-answered] owner Pusher broadcast failed:", e)
    return { broadcast: false }
  }
}
