// ============================================
// POST /api/voice/telnyx/status
// ============================================
// Telnyx call status callback. Updates the call log with final status/duration.
// Configure this URL in your Telnyx TeXML app or connection as the status callback.
// Dial `<Number statusCallbackEvent="initiated ringing answered completed">` also hits here
// so inbound progress events are not dropped before the dashboard.

import { after } from "next/server"
import { NextRequest, NextResponse } from "next/server"
import { getCallLogSnapshotForTelemetry, recordCallStatusEvent, updateCallLog } from "@/lib/db"
import { evaluateLowCarrierCreditFromCallUsage } from "@/lib/carrier-credit-alerts"
import { broadcastCallCompletedBySid } from "@/lib/call-telemetry-realtime"
import { maybeSendPostCallDispositionSms } from "@/lib/post-call-disposition-sms"
import { maybeSendAdminOverrideDispatchSms } from "@/lib/admin-override-dispatch-sms"
import { settleCallEarningsBySid } from "@/lib/compensation/settle-call"
import { maybeQueuePostCallReviewSms } from "@/lib/post-call-review-sms"
import { parseTelnyxTalkSecondsFromForm } from "@/lib/telnyx-call-duration"
import {
  isAutomatedCallHandler,
  MIN_LIVE_ANSWER_DURATION_SECONDS,
} from "@/lib/missed-call-telemetry"
import { CAPTURE_STATUS_AI_FALLBACK_HANDLED, isHoldAutomationStatus } from "@/lib/inbound-time-capture"
import { reportAiAssistantMinutesUsage } from "@/lib/ai-usage-billing"
import type { CallType } from "@/lib/types"

export const runtime = "nodejs"
export const preferredRegion = "iad1"

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  // Prefer parent call SID when Telnyx posts dial-leg (Number) progress events.
  const callSid =
    (formData.get("ParentCallSid") as string) ||
    (formData.get("CallSid") as string) ||
    (formData.get("CallControlId") as string) ||
    (formData.get("call_control_id") as string) ||
    ""
  const callStatus = String(formData.get("CallStatus") || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
  const duration = parseTelnyxTalkSecondsFromForm(formData)
  const direction = (formData.get("Direction") as string) || ""
  const fromNumber =
    String(formData.get("From") || formData.get("Caller") || formData.get("from") || "").trim()
  const toNumber =
    String(formData.get("To") || formData.get("Called") || formData.get("to") || "").trim()
  const eventTimestamp =
    (formData.get("Timestamp") as string) ||
    (formData.get("EventTimestamp") as string) ||
    ""

  try {
    let callType: CallType = "incoming"
    if (direction === "outbound-api" || direction === "outbound-dial") {
      callType = "outgoing"
    } else if (callStatus === "no-answer" || callStatus === "busy") {
      callType = "missed"
    }

    // Snapshot — IVR Gather sets carrier "answered" but is not a human bridge.
    const snapshot = await getCallLogSnapshotForTelemetry(callSid).catch(() => null)
    const automated = isAutomatedCallHandler(snapshot?.routed_to_name ?? null)
    const shortTalk =
      Number.isFinite(duration) &&
      duration >= 0 &&
      duration < MIN_LIVE_ANSWER_DURATION_SECONDS
    // Press-1 confirmation owns answered_at for receptionist legs; owner Your Phone
    // stamps it on immediate bridge via receptionist-answer — ignore carrier "answered" here.
    // Never treat voicemail / automated handlers as a protected human pickup.
    const alreadyHumanAnswered =
      !automated &&
      Boolean(snapshot?.answered_at) &&
      snapshot?.call_type !== "voicemail" &&
      snapshot?.call_type !== "missed" &&
      !shortTalk

    // Your Phone / receptionist already accepted — never demote a real pickup to missed.
    if (alreadyHumanAnswered && callType === "missed" && !shortTalk) {
      callType = "incoming"
    }
    if (
      !automated &&
      !shortTalk &&
      callType !== "outgoing" &&
      duration >= MIN_LIVE_ANSWER_DURATION_SECONDS &&
      snapshot?.routed_to_name &&
      !isAutomatedCallHandler(snapshot.routed_to_name) &&
      snapshot.call_type !== "voicemail"
    ) {
      callType = snapshot.call_type === "voicemail" ? "voicemail" : "incoming"
    }

    // Progress events (initiated / ringing / answered) — persist status without stamping answered_at.
    // Hangup equivalents: completed / busy / failed / no-answer / canceled.
    try {
      await recordCallStatusEvent(callSid, callStatus, duration, eventTimestamp || undefined, {
        skipAnsweredTelemetry: true,
        // answered_at comes from receptionist-answer (owner instant bridge / recv press-1).
        skipAnsweredAt: true,
      })
    } catch (metricsError) {
      console.error("[Telnyx] Metrics update failed in status callback:", metricsError)
    }

    if (
      automated &&
      (callStatus === "completed" ||
        callStatus === "no-answer" ||
        callStatus === "busy" ||
        callStatus === "canceled")
    ) {
      callType = snapshot?.call_type === "voicemail" ? "voicemail" : "missed"
    }

    // Explicit voicemail rows stay voicemail on terminal events.
    if (snapshot?.call_type === "voicemail") {
      callType = "voicemail"
    }

    // Short "completed" legs (aborted connect / brief VM) → missed.
    if (
      callType !== "outgoing" &&
      (callStatus === "completed" || callStatus === "canceled" || callStatus === "no-answer") &&
      shortTalk
    ) {
      callType = snapshot?.call_type === "voicemail" ? "voicemail" : "missed"
    }

    // The bare `callType === "missed"` below already covers every missed call, so the
    // old trailing `(callType === "missed" && !alreadyHumanAnswered)` operand was
    // unreachable. Dropping it is behaviour-preserving. If the intent was that a missed
    // call should only clear a false answer when a human had NOT already picked up, then
    // it is the bare operand that needs the `&& !alreadyHumanAnswered` guard — that is a
    // behaviour change, so it is left alone here.
    const clearFalseAnswer =
      shortTalk ||
      callType === "voicemail" ||
      callType === "missed" ||
      automated

    await updateCallLog(callSid, {
      call_type: callType,
      status:
        alreadyHumanAnswered && callStatus === "no-answer" && !shortTalk
          ? "completed"
          : callStatus || snapshot?.status || "completed",
      ...(duration > 0 ? { duration_seconds: duration } : {}),
      // Clear machine / voicemail answered_at so Activities treat the leg as Missed.
      ...(clearFalseAnswer ? { answered_at: null } : {}),
    })

    const terminal = ["completed", "busy", "failed", "no-answer", "canceled"].includes(
      callStatus.trim().toLowerCase()
    )
    if (terminal) {
      // AI Assistant fallback (087) — final duration is only known here (TeXML has no
      // conversation.ended-style webhook); report it for Stripe metered-overage billing.
      if (snapshot?.routed_to_name === CAPTURE_STATUS_AI_FALLBACK_HANDLED && duration > 0) {
        void reportAiAssistantMinutesUsage(snapshot.user_id, duration, callSid)
      }
      void evaluateLowCarrierCreditFromCallUsage(callSid).catch((walletErr) => {
        console.error("[Telnyx] Low carrier credit evaluation failed:", walletErr)
      })
      after(async () => {
        try {
          await broadcastCallCompletedBySid(callSid)
        } catch (telemetryErr) {
          console.warn("[Telnyx] call-completed telemetry broadcast failed:", telemetryErr)
        }
        // Pay the receptionist for this leg. Runs after updateCallLog has cleared any
        // false answered_at, so a machine pickup does not settle as a conversation.
        try {
          await settleCallEarningsBySid(callSid)
        } catch (payErr) {
          // Not lost: with no ledger row, the next sweep picks the call up.
          console.error("[Telnyx] receptionist pay settlement failed:", payErr)
        }
        try {
          await maybeSendPostCallDispositionSms(callSid, callStatus)
        } catch (smsErr) {
          console.error("[Telnyx] Post-call disposition SMS failed:", smsErr)
        }
        try {
          await maybeSendAdminOverrideDispatchSms(callSid, callStatus)
        } catch (dispatchErr) {
          console.error("[Telnyx] Admin override dispatch SMS failed:", dispatchErr)
        }
        // Missed Call Rescue — true miss only (not Busy hangup / hold leave without press 1).
        try {
          const snap2 = await getCallLogSnapshotForTelemetry(callSid).catch(() => null)
          const routed = snap2?.routed_to_name ?? null
          // Busy menu / hold / capture SMS paths never get a second “missed” text.
          if (isHoldAutomationStatus(routed) || isAutomatedCallHandler(routed)) {
            // skip
          } else {
            const talkSec = Number(snap2?.duration_seconds ?? duration ?? 0)
            const humanAnswered =
              Boolean(snap2?.answered_at) &&
              !isAutomatedCallHandler(routed) &&
              talkSec >= MIN_LIVE_ANSWER_DURATION_SECONDS
          }
        } catch (rescueErr) {
          console.error("[Telnyx] Missed Call Rescue SMS failed:", rescueErr)
        }
        try {
          await maybeQueuePostCallReviewSms({
            callSid,
            callStatus,
            durationSeconds: duration,
            fromNumber: fromNumber || undefined,
            direction: direction || undefined,
          })
        } catch (reviewErr) {
          console.error("[Telnyx] Post-call review queue failed:", reviewErr)
        }
      })
    }
  } catch (error) {
    console.error("[Telnyx] Error in status callback:", error)
  }

  return new NextResponse("OK", { status: 200 })
}
