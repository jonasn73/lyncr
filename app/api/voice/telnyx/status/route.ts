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
import { maybeSendMissedCallRescueSms } from "@/lib/missed-call-rescue"
import { maybeQueuePostCallReviewSms } from "@/lib/post-call-review-sms"
import { parseTelnyxTalkSecondsFromForm } from "@/lib/telnyx-call-duration"
import {
  isAutomatedCallHandler,
  MIN_LIVE_ANSWER_DURATION_SECONDS,
} from "@/lib/missed-call-telemetry"
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
    // Press-1 confirmation owns answered_at — ignore carrier "answered" stamps for live metrics.
    const alreadyHumanAnswered =
      !automated &&
      Boolean(snapshot?.answered_at) &&
      snapshot?.call_type !== "voicemail" &&
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
      !isAutomatedCallHandler(snapshot.routed_to_name)
    ) {
      callType = snapshot.call_type === "voicemail" ? "voicemail" : "incoming"
    }

    // Progress events (initiated / ringing / answered) — persist status without stamping answered_at.
    // Hangup equivalents: completed / busy / failed / no-answer / canceled.
    try {
      await recordCallStatusEvent(callSid, callStatus, duration, eventTimestamp || undefined, {
        skipAnsweredTelemetry: true,
        // Anti-voicemail: only receptionist-answer press-1 sets answered_at.
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

    // Short "completed" legs (voicemail pickup without press-1) → missed.
    if (
      callType !== "outgoing" &&
      (callStatus === "completed" || callStatus === "canceled" || callStatus === "no-answer") &&
      shortTalk
    ) {
      callType = "missed"
    }

    const clearFalseAnswer = shortTalk || (callType === "missed" && !alreadyHumanAnswered)

    await updateCallLog(callSid, {
      call_type: callType,
      status:
        alreadyHumanAnswered && callStatus === "no-answer" && !shortTalk
          ? "completed"
          : callStatus || snapshot?.status || "completed",
      ...(duration > 0 ? { duration_seconds: duration } : {}),
      // Clear machine / voicemail answered_at so Activities treat the leg as Missed.
      ...(automated && callType === "missed" ? { answered_at: null } : {}),
      ...(clearFalseAnswer && callType === "missed" ? { answered_at: null } : {}),
    })

    const terminal = ["completed", "busy", "failed", "no-answer", "canceled"].includes(
      callStatus.trim().toLowerCase()
    )
    if (terminal) {
      void evaluateLowCarrierCreditFromCallUsage(callSid).catch((walletErr) => {
        console.error("[Telnyx] Low carrier credit evaluation failed:", walletErr)
      })
      after(async () => {
        try {
          await broadcastCallCompletedBySid(callSid)
        } catch (telemetryErr) {
          console.warn("[Telnyx] call-completed telemetry broadcast failed:", telemetryErr)
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
        // Missed Call Rescue — skip legs that already had a confirmed human answer.
        try {
          const snap2 = await getCallLogSnapshotForTelemetry(callSid).catch(() => null)
          const talkSec = Number(snap2?.duration_seconds ?? duration ?? 0)
          const humanAnswered =
            Boolean(snap2?.answered_at) &&
            !isAutomatedCallHandler(snap2?.routed_to_name) &&
            talkSec >= MIN_LIVE_ANSWER_DURATION_SECONDS
          const preferRescue =
            !humanAnswered &&
            (callStatus === "no-answer" ||
              callStatus === "busy" ||
              callStatus === "canceled" ||
              (callStatus === "completed" &&
                (talkSec < 45 || talkSec < MIN_LIVE_ANSWER_DURATION_SECONDS) &&
                !humanAnswered))
          if (preferRescue && fromNumber && toNumber) {
            await maybeSendMissedCallRescueSms({
              callSid,
              callStatus,
              fromNumber,
              toNumber,
              preferRescue: true,
            })
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
