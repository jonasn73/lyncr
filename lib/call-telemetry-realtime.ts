// Realtime owner-channel events that keep the routing HUD call metrics fresh.

import { getCallLogSnapshotForTelemetry, getCallLogUserIdByProviderSid } from "@/lib/db"
import type {
  OwnerCallAnsweredPayload,
  OwnerCallCompletedPayload,
  OwnerCallInitiatedPayload,
} from "@/lib/realtime/owner-call-event-types"
import { publishOwnerEvent } from "@/lib/realtime/pusher-server"

/** Fired when an inbound call row is created (Telnyx call.initiated / first ring). */
export async function broadcastCallInitiated(params: {
  ownerUserId: string
  callSid: string
  fromNumber: string
  toNumber: string
  organizationId?: string | null
}): Promise<void> {
  const payload: OwnerCallInitiatedPayload = {
    call_sid: params.callSid,
    from_number: params.fromNumber,
    to_number: params.toNumber,
    organization_id: params.organizationId ?? null,
  }
  await publishOwnerEvent(params.ownerUserId, "call-initiated", payload)
}

/** Fired when an inbound call is answered / bridged — opens the intake sheet while the caller is still on the line. */
export async function broadcastCallAnswered(params: {
  ownerUserId: string
  callSid: string
  callLogId: string
  fromNumber: string
  toNumber?: string | null
  organizationId?: string | null
  answeredAt?: string | null
}): Promise<void> {
  const payload: OwnerCallAnsweredPayload = {
    call_sid: params.callSid,
    call_log_id: params.callLogId,
    from_number: params.fromNumber,
    to_number: params.toNumber ?? null,
    organization_id: params.organizationId ?? null,
    answered_at: params.answeredAt ?? null,
  }
  await publishOwnerEvent(params.ownerUserId, "call-answered", payload)
}

/** Fired when a call reaches a terminal status (updates missed + talk time). */
export async function broadcastCallCompleted(params: {
  ownerUserId: string
  callSid: string
  organizationId?: string | null
  toNumber?: string | null
  fromNumber?: string | null
  callLogId?: string | null
  durationSeconds?: number
  callType?: string | null
  status?: string | null
  answeredAt?: string | null
}): Promise<void> {
  const payload: OwnerCallCompletedPayload = {
    call_sid: params.callSid,
    organization_id: params.organizationId ?? null,
    to_number: params.toNumber ?? null,
    from_number: params.fromNumber ?? null,
    call_log_id: params.callLogId ?? null,
    duration_seconds: params.durationSeconds ?? 0,
    call_type: params.callType ?? null,
    status: params.status ?? null,
    answered_at: params.answeredAt ?? null,
  }
  await publishOwnerEvent(params.ownerUserId, "call-completed", payload)
}

/** Resolve call row and publish call-answered for the intake sheet (TeXML + Call Control). */
export async function broadcastCallAnsweredBySid(callSid: string): Promise<void> {
  const snapshot = await getCallLogSnapshotForTelemetry(callSid)
  if (!snapshot) return
  if (snapshot.call_type !== "incoming") return
  if (!snapshot.answered_at) return
  await broadcastCallAnswered({
    ownerUserId: snapshot.user_id,
    callSid,
    callLogId: snapshot.id,
    fromNumber: snapshot.from_number,
    toNumber: snapshot.to_number,
    organizationId: snapshot.organization_id,
    answeredAt: snapshot.answered_at,
  })
}

/** Resolve call row and publish call-completed with metric deltas for the owner HUD. */
export async function broadcastCallCompletedBySid(callSid: string): Promise<void> {
  const snapshot = await getCallLogSnapshotForTelemetry(callSid)
  if (snapshot) {
    await broadcastCallCompleted({
      ownerUserId: snapshot.user_id,
      callSid,
      organizationId: snapshot.organization_id,
      toNumber: snapshot.to_number,
      fromNumber: snapshot.from_number,
      callLogId: snapshot.id,
      durationSeconds: snapshot.duration_seconds,
      callType: snapshot.call_type,
      status: snapshot.status,
      answeredAt: snapshot.answered_at,
    })
    return
  }
  const ownerUserId = await getCallLogUserIdByProviderSid(callSid)
  if (!ownerUserId) return
  await broadcastCallCompleted({ ownerUserId, callSid })
}
