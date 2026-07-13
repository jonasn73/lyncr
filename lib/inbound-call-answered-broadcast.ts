// Single hub: carrier "leg answered" webhook → owner-{userId} Pusher `call-answered`.
// Used by TeXML <Number url> / <Sip url>, Telnyx status callbacks, and Call Control bridge.

import { after } from "next/server"
import { broadcastCallAnswered } from "@/lib/call-telemetry-realtime"
import {
  ensureCallLogForInboundLeg,
  getCallLogSnapshotForTelemetry,
  recordCallStatusEvent,
} from "@/lib/db"

export type NotifyOwnerInboundCallAnsweredParams = {
  /** Telnyx CallSid / call_logs.provider_call_sid */
  providerCallSid: string
  occurredAtIso?: string
  /** Fallback when the inbound row is not written yet (fast-path race). */
  ownerUserId?: string | null
  /** Neon call_logs.id from answer URL `lid` — enables instant Pusher without a DB read. */
  callLogId?: string | null
  fromNumber?: string | null
  toNumber?: string | null
  callerName?: string | null
}

async function broadcastFromSnapshot(providerCallSid: string): Promise<boolean> {
  const snapshot = await getCallLogSnapshotForTelemetry(providerCallSid)
  if (!snapshot || !snapshot.answered_at) return false
  // Allow rows briefly tagged missed before answer tags landed — intake still must open.
  if (snapshot.call_type === "voicemail" || snapshot.call_type === "outgoing") return false
  await broadcastCallAnswered({
    ownerUserId: snapshot.user_id,
    callSid: providerCallSid,
    callLogId: snapshot.id,
    fromNumber: snapshot.from_number,
    toNumber: snapshot.to_number,
    organizationId: snapshot.organization_id,
    answeredAt: snapshot.answered_at,
  })
  return true
}

function persistAnsweredCallLog(params: {
  providerCallSid: string
  occurredAtIso: string
  ownerUserId?: string
  fromNumber?: string
  toNumber?: string
  callerName?: string | null
  skipAnsweredTelemetry: boolean
}): void {
  after(async () => {
    if (params.ownerUserId) {
      try {
        await ensureCallLogForInboundLeg({
          userId: params.ownerUserId,
          providerCallSid: params.providerCallSid,
          fromNumber: params.fromNumber || "Unknown",
          toNumber: params.toNumber || "Unknown",
          callerName: params.callerName?.trim() || null,
        })
      } catch (e) {
        console.warn("[inbound-call-answered] ensure call log failed:", e)
      }
    }
    try {
      await recordCallStatusEvent(params.providerCallSid, "answered", 0, params.occurredAtIso, {
        skipAnsweredTelemetry: params.skipAnsweredTelemetry,
      })
    } catch (e) {
      console.warn("[inbound-call-answered] recordCallStatusEvent failed:", e)
    }
  })
}

/**
 * Mark the inbound call answered in Neon and push `call-answered` on the owner dashboard channel.
 * When `callLogId` + owner + caller are on the answer URL, Pusher fires first (sub-second modal).
 */
export async function notifyOwnerInboundCallAnswered(
  params: NotifyOwnerInboundCallAnsweredParams
): Promise<{ broadcast: boolean }> {
  const sid = params.providerCallSid.trim()
  if (!sid) return { broadcast: false }

  const occurredAt = params.occurredAtIso ?? new Date().toISOString()
  const ownerUserId = params.ownerUserId?.trim()
  const callLogId = params.callLogId?.trim()
  const fromNumber = params.fromNumber?.trim()
  const toNumber = params.toNumber?.trim()

  // Instant path: answer URL already has Neon row id + caller from /incoming (no DB round-trip).
  if (ownerUserId && callLogId && fromNumber) {
    try {
      await broadcastCallAnswered({
        ownerUserId,
        callSid: sid,
        callLogId,
        fromNumber,
        toNumber: toNumber || null,
        answeredAt: occurredAt,
      })
      persistAnsweredCallLog({
        providerCallSid: sid,
        occurredAtIso: occurredAt,
        ownerUserId,
        fromNumber,
        toNumber,
        callerName: params.callerName,
        skipAnsweredTelemetry: true,
      })
      return { broadcast: true }
    } catch (e) {
      console.warn("[inbound-call-answered] early broadcast failed:", e)
    }
  }

  if (ownerUserId) {
    try {
      await ensureCallLogForInboundLeg({
        userId: ownerUserId,
        providerCallSid: sid,
        fromNumber: fromNumber || "Unknown",
        toNumber: toNumber || "Unknown",
        callerName: params.callerName?.trim() || null,
      })
    } catch (e) {
      console.warn("[inbound-call-answered] ensure call log failed:", e)
    }
  }

  try {
    await recordCallStatusEvent(sid, "answered", 0, occurredAt)
  } catch (e) {
    console.warn("[inbound-call-answered] recordCallStatusEvent failed:", e)
  }

  try {
    if (await broadcastFromSnapshot(sid)) return { broadcast: true }
  } catch (e) {
    console.warn("[inbound-call-answered] broadcast failed:", e)
  }

  return { broadcast: false }
}
