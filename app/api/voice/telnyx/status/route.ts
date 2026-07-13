// ============================================
// POST /api/voice/telnyx/status
// ============================================
// Telnyx call status callback. Updates the call log with final status/duration.
// Configure this URL in your Telnyx TeXML app or connection as the status callback.

import { after } from "next/server"
import { NextRequest, NextResponse } from "next/server"
import { getCallLogSnapshotForTelemetry, recordCallStatusEvent, updateCallLog } from "@/lib/db"
import { evaluateLowCarrierCreditFromCallUsage } from "@/lib/carrier-credit-alerts"
import { notifyOwnerInboundCallAnswered } from "@/lib/inbound-call-answered-broadcast"
import { broadcastCallCompletedBySid } from "@/lib/call-telemetry-realtime"
import { maybeSendPostCallDispositionSms } from "@/lib/post-call-disposition-sms"
import { maybeSendAdminOverrideDispatchSms } from "@/lib/admin-override-dispatch-sms"
import { maybeSendMissedCallRescueSms } from "@/lib/missed-call-rescue"
import { parseTelnyxTalkSecondsFromForm } from "@/lib/telnyx-call-duration"
import { isAutomatedCallHandler } from "@/lib/missed-call-telemetry"
import type { CallType } from "@/lib/types"

export const runtime = "nodejs"
export const preferredRegion = "iad1"

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const callSid =
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
    const alreadyHumanAnswered =
      !automated && Boolean(snapshot?.answered_at) && snapshot?.call_type !== "voicemail"

    // Your Phone / receptionist already accepted — never demote a short pickup to missed.
    if (alreadyHumanAnswered && callType === "missed") {
      callType = "incoming"
    }
    if (
      !automated &&
      callType !== "outgoing" &&
      duration > 0 &&
      snapshot?.routed_to_name &&
      !isAutomatedCallHandler(snapshot.routed_to_name)
    ) {
      callType = snapshot.call_type === "voicemail" ? "voicemail" : "incoming"
    }

    try {
      await recordCallStatusEvent(callSid, callStatus, duration, eventTimestamp || undefined, {
        skipAnsweredTelemetry: automated,
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

    await updateCallLog(callSid, {
      call_type: callType,
      status: alreadyHumanAnswered && callStatus === "no-answer" ? "completed" : callStatus,
      ...(duration > 0 ? { duration_seconds: duration } : {}),
      // Clear machine "answered_at" so metrics / Activities never treat IVR as live Answered.
      ...(automated && callType === "missed" ? { answered_at: null } : {}),
    })

    const answeredLive = ["answered", "in-progress"].includes(callStatus)
    if (answeredLive && !automated) {
      try {
        await notifyOwnerInboundCallAnswered({
          providerCallSid: callSid,
          occurredAtIso: eventTimestamp || undefined,
          fromNumber: fromNumber || undefined,
          toNumber: toNumber || undefined,
        })
      } catch (telemetryErr) {
        console.warn("[Telnyx] call-answered telemetry broadcast failed:", telemetryErr)
      }
    }

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
        // Missed Call Rescue — skip legs that already had a human answer.
        try {
          const snap2 = await getCallLogSnapshotForTelemetry(callSid).catch(() => null)
          const humanAnswered =
            Boolean(snap2?.answered_at) && !isAutomatedCallHandler(snap2?.routed_to_name)
          const preferRescue =
            !humanAnswered &&
            (callStatus === "no-answer" ||
              callStatus === "busy" ||
              callStatus === "canceled" ||
              (callStatus === "completed" && duration > 0 && duration < 45 && !snap2?.answered_at))
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
      })
    }
  } catch (error) {
    console.error("[Telnyx] Error in status callback:", error)
  }

  return new NextResponse("OK", { status: 200 })
}
