// Persist Call Control lifecycle into call_logs (answer, talk time, completion).

import { notifyOwnerInboundCallAnswered } from "@/lib/inbound-call-answered-broadcast"
import { broadcastCallCompleted } from "@/lib/call-telemetry-realtime"
import { evaluateLowCarrierCreditFromCallUsage } from "@/lib/carrier-credit-alerts"
import { normalizeTelnyxDurationSeconds, parseTelnyxCallDurationFromPayload } from "@/lib/telnyx-call-duration"
import type { TelnyxVoiceWebhookEvent } from "@/lib/telnyx-call-control-parse"
import type { TelnyxCallControlClientState } from "@/lib/telnyx-call-control-state"
import { maybeSendAdminOverrideDispatchSms } from "@/lib/admin-override-dispatch-sms"
import { maybeSendPostCallDispositionSms } from "@/lib/post-call-disposition-sms"
import { getIncomingRoutingForVoiceWebhook, getCallLogSnapshotForTelemetry, recordCallStatusEvent, updateCallLog } from "@/lib/db"
import type { CallType } from "@/lib/types"

/** Inbound caller leg SID — the row created on call.initiated. */
export function resolveInboundCallLogSid(event: TelnyxVoiceWebhookEvent): string {
  const inbound = event.clientState?.inboundCallControlId?.trim()
  if (inbound) return inbound
  return event.callControlId
}

/** True when this webhook is for the outbound owner/receptionist PSTN leg. */
export function isOutboundDialLegEvent(event: TelnyxVoiceWebhookEvent): boolean {
  const inbound = event.clientState?.inboundCallControlId?.trim()
  if (!inbound) return false
  return event.callControlId !== inbound
}

export function isDialNoAnswerHangup(event: TelnyxVoiceWebhookEvent): boolean {
  return (
    event.dialStatus === "no_answer" ||
    event.dialStatus === "timeout" ||
    event.hangupCause === "timeout" ||
    event.hangupCause === "no_answer" ||
    event.hangupCause === "user_busy" ||
    event.hangupCause === "call_rejected"
  )
}

export function parseTelnyxCallDurationFromVoiceEvent(event: TelnyxVoiceWebhookEvent): number {
  if (event.callDurationSeconds > 0) return event.callDurationSeconds
  if (event.startTime && event.endTime) {
    const startMs = Date.parse(event.startTime)
    const endMs = Date.parse(event.endTime)
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
      return Math.round((endMs - startMs) / 1000)
    }
  }
  return 0
}

function mapHangupCauseToStatus(hangupCause: string, hadConversation: boolean): string {
  const c = hangupCause.trim().toLowerCase()
  if (c === "normal_clearing") return "completed"
  if (c === "user_busy") return "busy"
  if (c === "no_answer" || c === "timeout" || c === "time_limit") return "no-answer"
  if (c === "call_rejected") return "failed"
  if (c === "originator_cancel") return hadConversation ? "completed" : "canceled"
  return hadConversation ? "completed" : "no-answer"
}

function resolveRoutedToLabel(
  routing: NonNullable<Awaited<ReturnType<typeof getIncomingRoutingForVoiceWebhook>>>
): string {
  if (routing.selected_receptionist_id?.trim() && routing.receptionist_name?.trim()) {
    return routing.receptionist_name.trim()
  }
  return "Owner"
}

function runTerminalCallSideEffects(
  callSid: string,
  status: string,
  durationSeconds: number
): void {
  const terminal = ["completed", "busy", "failed", "no-answer", "canceled"].includes(status)
  if (!terminal) return
  void evaluateLowCarrierCreditFromCallUsage(callSid).catch((e) => {
    console.error("[telnyx-cc] carrier credit check failed:", e)
  })
  void (async () => {
    const snapshot = await getCallLogSnapshotForTelemetry(callSid).catch(() => null)
    if (snapshot) {
      try {
        await broadcastCallCompleted({
          ownerUserId: snapshot.user_id,
          callSid,
          organizationId: snapshot.organization_id,
          toNumber: snapshot.to_number,
          fromNumber: snapshot.from_number,
          callLogId: snapshot.id,
          durationSeconds: Math.max(durationSeconds, snapshot.duration_seconds ?? 0),
          callType: snapshot.call_type,
          status: snapshot.status,
          answeredAt: snapshot.answered_at,
          endedAt: snapshot.ended_at,
          routedToName: snapshot.routed_to_name,
          receptionistId: snapshot.routed_to_receptionist_id,
        })
      } catch (e) {
        console.warn("[telnyx-cc] call-completed broadcast failed:", e)
      }
    }
    try {
      await maybeSendPostCallDispositionSms(callSid, status)
    } catch (e) {
      console.error("[telnyx-cc] post-call SMS failed:", e)
    }
    try {
      await maybeSendAdminOverrideDispatchSms(callSid, status)
    } catch (e) {
      console.error("[telnyx-cc] admin dispatch SMS failed:", e)
    }
  })()
}

/** Mark inbound call answered when caller and owner are bridged. */
export async function persistCallControlBridged(
  inboundCallSid: string,
  state: TelnyxCallControlClientState,
  occurredAtIso: string
): Promise<void> {
  const routing = await getIncomingRoutingForVoiceWebhook(state.businessLineE164).catch(() => null)
  const routedToName = routing ? resolveRoutedToLabel(routing) : "Owner"
  try {
    await notifyOwnerInboundCallAnswered({
      providerCallSid: inboundCallSid,
      occurredAtIso: occurredAtIso || undefined,
    }).catch((e) => {
      console.warn("[telnyx-cc] call-answered broadcast failed:", e)
    })
    await updateCallLog(inboundCallSid, {
      status: "in-progress",
      routed_to_name: routedToName,
    })
    console.log(
      JSON.stringify({
        zing: "telnyx-cc-call-log-bridged",
        inboundCallSid,
        routedToName,
      })
    )
  } catch (e) {
    console.error("[telnyx-cc] bridged call log update failed:", e)
  }
}

/** Owner/receptionist did not answer — mark missed before voicemail prompt. */
export async function persistCallControlDialNoAnswer(
  inboundCallSid: string,
  event: TelnyxVoiceWebhookEvent
): Promise<void> {
  const duration = parseTelnyxCallDurationFromVoiceEvent(event)
  const status = mapHangupCauseToStatus(event.hangupCause, false)
  try {
    await recordCallStatusEvent(inboundCallSid, status, duration, event.occurredAt || undefined)
    await updateCallLog(inboundCallSid, {
      call_type: "missed",
      status,
      ...(duration > 0 ? { duration_seconds: duration } : {}),
    })
  } catch (e) {
    console.error("[telnyx-cc] dial no-answer call log update failed:", e)
  }
}

/** Finalize inbound caller leg on hangup (completed talk, early cancel, or voicemail). */
export async function finalizeCallControlCallLog(
  inboundCallSid: string,
  event: TelnyxVoiceWebhookEvent,
  opts?: { callType?: CallType; hadConversation?: boolean }
): Promise<void> {
  const snapshot = await getCallLogSnapshotForTelemetry(inboundCallSid).catch(() => null)
  const ownerLiveAnswered = Boolean(snapshot?.routed_to_name?.trim())
  const hadConversation =
    opts?.hadConversation ??
    (ownerLiveAnswered || event.clientState?.phase === "recording")
  const duration = parseTelnyxCallDurationFromVoiceEvent(event)
  const status = mapHangupCauseToStatus(event.hangupCause, hadConversation)
  let callType: CallType = opts?.callType ?? "incoming"
  if (!opts?.callType) {
    if (status === "no-answer" || status === "busy" || status === "canceled") callType = "missed"
    if (event.clientState?.phase === "recording") callType = "voicemail"
    if (status === "completed" && hadConversation) callType = "incoming"
    if (
      (status === "completed" || status === "canceled") &&
      !ownerLiveAnswered &&
      event.clientState?.phase !== "recording"
    ) {
      callType = "missed"
    }
  }

  try {
    await recordCallStatusEvent(inboundCallSid, status, duration, event.occurredAt || undefined)
    await updateCallLog(inboundCallSid, {
      call_type: callType,
      status,
      ...(duration > 0 ? { duration_seconds: duration } : {}),
      ...(callType === "missed" && !ownerLiveAnswered ? { answered_at: null } : {}),
    })
    console.log(
      JSON.stringify({
        zing: "telnyx-cc-call-log-finalized",
        inboundCallSid,
        status,
        callType,
        durationSeconds: duration,
        hangupCause: event.hangupCause || null,
      })
    )
    runTerminalCallSideEffects(inboundCallSid, status, duration)
  } catch (e) {
    console.error("[telnyx-cc] finalize call log failed:", e)
  }
}
