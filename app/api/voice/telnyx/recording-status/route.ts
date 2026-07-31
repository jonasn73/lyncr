// ============================================
// POST /api/voice/telnyx/recording-status
// ============================================
// Telnyx recording status callback. Updates the call log with recording URL/duration.
// Supports TeXML-compatible callback parameter names.

import { NextRequest, NextResponse } from "next/server"
import { broadcastCallRecordingReady } from "@/lib/call-telemetry-realtime"
import { getCallLogSnapshotForTelemetry, updateCallLog } from "@/lib/db"
import { VOICEMAIL_ROUTED_TO_NAME, isAutomatedCallHandler } from "@/lib/missed-call-telemetry"

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const callSid = (formData.get("CallSid") as string) || ""
  const recordingUrl =
    (formData.get("RecordingUrl") as string) || (formData.get("RecordingURL") as string) || ""
  const recordingDuration = parseInt(
    (formData.get("RecordingDuration") as string) || "0",
    10
  )
  const recordingStatus = (formData.get("RecordingStatus") as string) || ""

  try {
    if (recordingStatus === "completed" && recordingUrl) {
      const normalizedUrl = recordingUrl.endsWith(".mp3") ? recordingUrl : `${recordingUrl}.mp3`
      const snapshot = await getCallLogSnapshotForTelemetry(callSid).catch(() => null)
      // Only demote when this row is already tagged as machine-handled / voicemail.
      // Do not invent voicemail from a bare recording URL (wrap-up legs also record).
      const demoteFalseAnswer =
        snapshot?.call_type === "voicemail" ||
        snapshot?.call_type === "missed" ||
        isAutomatedCallHandler(snapshot?.routed_to_name) ||
        Boolean(snapshot?.routed_to_name && /\bvoicemail\b/i.test(snapshot.routed_to_name))

      await updateCallLog(callSid, {
        has_recording: true,
        recording_url: normalizedUrl,
        recording_duration_seconds: recordingDuration,
        ...(demoteFalseAnswer
          ? {
              call_type: (snapshot?.call_type === "missed" ? "missed" : "voicemail") as
                | "missed"
                | "voicemail",
              answered_at: null,
              routed_to_name:
                snapshot?.routed_to_name && isAutomatedCallHandler(snapshot.routed_to_name)
                  ? snapshot.routed_to_name
                  : snapshot?.routed_to_name?.trim() || VOICEMAIL_ROUTED_TO_NAME,
            }
          : {}),
      })

      const snap2 = snapshot ?? (await getCallLogSnapshotForTelemetry(callSid))
      if (snap2?.user_id && snap2.id) {
        await broadcastCallRecordingReady({
          ownerUserId: snap2.user_id,
          callLogId: snap2.id,
          recordingUrl: normalizedUrl,
        }).catch((e) => {
          console.warn("[Telnyx] call-recording-ready publish failed:", e)
        })
      }
    }
  } catch (error) {
    console.error("[Telnyx] Error in recording status callback:", error)
  }

  return new NextResponse("OK", { status: 200 })
}
