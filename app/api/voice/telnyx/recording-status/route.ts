// ============================================
// POST /api/voice/telnyx/recording-status
// ============================================
// Telnyx recording status callback. Updates the call log with recording URL/duration.
// Supports TeXML-compatible callback parameter names.

import { NextRequest, NextResponse } from "next/server"
import { broadcastCallRecordingReady } from "@/lib/call-telemetry-realtime"
import { getCallLogSnapshotForTelemetry, updateCallLog } from "@/lib/db"

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
      await updateCallLog(callSid, {
        has_recording: true,
        recording_url: normalizedUrl,
        recording_duration_seconds: recordingDuration,
      })

      const snapshot = await getCallLogSnapshotForTelemetry(callSid)
      if (snapshot?.user_id && snapshot.id) {
        await broadcastCallRecordingReady({
          ownerUserId: snapshot.user_id,
          callLogId: snapshot.id,
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
