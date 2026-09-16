// ============================================
// POST /api/voice/telnyx/hold-vehicle-note
// ============================================
// Recording callback for the hold queue's spoken make/model clip (Phase 3).
// Same TeXML-compatible parameter shape as /api/voice/telnyx/recording-status,
// but deliberately a separate route: that one demotes calls to voicemail and
// writes call_logs recording fields — behavior a 10-second prompted answer clip
// must never trigger. This one only transcribes and merges the vehicle into
// call_queue.collected (which auto-broadcasts to the Lines waiting card and
// feeds the booking-link pre-fill).

import { NextRequest, NextResponse } from "next/server"
import { getCallQueueCollectedByCallControlId, mergeCallQueueCollected } from "@/lib/call-queue-db"
import { transcribeRecording } from "@/lib/transcribe-audio"
import { parseVehicleFromTranscript } from "@/lib/vehicle-transcript-parse"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const callSid = (formData.get("CallSid") as string) || ""
  const recordingUrl =
    (formData.get("RecordingUrl") as string) || (formData.get("RecordingURL") as string) || ""
  const recordingStatus = (formData.get("RecordingStatus") as string) || ""

  try {
    if (callSid && recordingUrl && (!recordingStatus || recordingStatus === "completed")) {
      const collected = await getCallQueueCollectedByCallControlId(callSid)
      // Only clips this call explicitly marked as the vehicle answer, exactly once.
      if (collected.vehicle_voice_pending === true) {
        const normalizedUrl = recordingUrl.endsWith(".mp3") ? recordingUrl : `${recordingUrl}.mp3`
        const transcript = await transcribeRecording(normalizedUrl)
        const parsed = parseVehicleFromTranscript(transcript)
        const label = parsed?.make
          ? [parsed.make, parsed.model].filter(Boolean).join(" ")
          : null
        // A keypad-typed year (the deterministic fallback) always wins over a
        // transcribed one — only fill the year when none is on file yet.
        const hasYearAlready =
          typeof collected.vehicle_year === "string" && collected.vehicle_year.trim() !== ""
        const useVoiceYear = Boolean(parsed?.year) && !hasYearAlready
        await mergeCallQueueCollected(callSid, {
          vehicle_voice_pending: false,
          vehicle_voice_url: normalizedUrl,
          // Raw-ish transcript survives even when no make matched — the owner can
          // still read "silver pickup with a camper shell" on the waiting card data.
          ...(parsed?.cleaned ? { vehicle_voice_transcript: parsed.cleaned } : {}),
          ...(parsed?.make ? { vehicle_make: parsed.make } : {}),
          ...(parsed?.model ? { vehicle_model: parsed.model } : {}),
          ...(useVoiceYear
            ? {
                vehicle_year: parsed!.year,
                vehicle_year_label: `Year ${parsed!.year}`,
                // Lets the confirm's "say it again" wipe voice years but never typed ones.
                vehicle_year_source: "voice",
              }
            : {}),
          // *_label keys auto-render on the Lines waiting card.
          ...(label ? { vehicle_make_model_label: label } : {}),
        })
        console.log(
          JSON.stringify({
            lyncr: "hold-vehicle-note-transcribed",
            matchedMake: parsed?.make ?? null,
            matchedYear: parsed?.year ?? null,
            hasTranscript: Boolean(parsed?.cleaned),
          })
        )
      }
    }
  } catch (error) {
    console.error("[Telnyx] hold-vehicle-note callback failed:", error)
  }

  return new NextResponse("OK", { status: 200 })
}
