// ============================================
// POST /api/voice/telnyx/status
// ============================================
// Telnyx call status callback. Updates the call log with final status/duration.
// Configure this URL in your Telnyx TeXML app or connection as the status callback.

import { NextRequest, NextResponse } from "next/server"
import { recordCallStatusEvent, updateCallLog } from "@/lib/db"
import { evaluateLowCarrierCreditFromCallUsage } from "@/lib/carrier-credit-alerts"
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
  const callStatus = (formData.get("CallStatus") as string) || ""
  const duration = parseInt((formData.get("CallDuration") as string) || "0", 10)
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

    await updateCallLog(callSid, { call_type: callType, status: callStatus, duration_seconds: duration })

    const terminal = ["completed", "busy", "failed", "no-answer", "canceled"].includes(
      callStatus.trim().toLowerCase()
    )
    if (terminal) {
      void evaluateLowCarrierCreditFromCallUsage(callSid).catch((walletErr) => {
        console.error("[Telnyx] Low carrier credit evaluation failed:", walletErr)
      })
    }
  } catch (error) {
    console.error("[Telnyx] Error in status callback:", error)
  }

  return new NextResponse("OK", { status: 200 })
}
