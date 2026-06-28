// ============================================
// POST /api/voice/telnyx/status
// ============================================
// Telnyx call status callback. Updates the call log with final status/duration.
// Configure this URL in your Telnyx TeXML app or connection as the status callback.

import { after } from "next/server"
import { NextRequest, NextResponse } from "next/server"
import { recordCallStatusEvent, updateCallLog } from "@/lib/db"
import { evaluateLowCarrierCreditFromCallUsage } from "@/lib/carrier-credit-alerts"
import { broadcastCallAnsweredBySid, broadcastCallCompletedBySid } from "@/lib/call-telemetry-realtime"
import { maybeSendPostCallDispositionSms } from "@/lib/post-call-disposition-sms"
import { maybeSendAdminOverrideDispatchSms } from "@/lib/admin-override-dispatch-sms"
import { parseTelnyxTalkSecondsFromForm } from "@/lib/telnyx-call-duration"
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

    // Timing metrics update can fail safely (e.g. before migration runs).
    try {
      await recordCallStatusEvent(callSid, callStatus, duration, eventTimestamp || undefined)
    } catch (metricsError) {
      console.error("[Telnyx] Metrics update failed in status callback:", metricsError)
    }

    await updateCallLog(callSid, {
      call_type: callType,
      status: callStatus,
      ...(duration > 0 ? { duration_seconds: duration } : {}),
    })

    const answeredLive = ["answered", "in-progress"].includes(callStatus)
    if (answeredLive && callType === "incoming") {
      after(async () => {
        try {
          await broadcastCallAnsweredBySid(callSid)
        } catch (telemetryErr) {
          console.warn("[Telnyx] call-answered telemetry broadcast failed:", telemetryErr)
        }
      })
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
      })
    }
  } catch (error) {
    console.error("[Telnyx] Error in status callback:", error)
  }

  return new NextResponse("OK", { status: 200 })
}
