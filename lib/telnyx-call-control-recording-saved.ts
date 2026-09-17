// `call.recording.saved` — Call Control's ONLY delivery path for a finished
// record_start/record_stop clip. Telnyx always sends this to the account's Call
// Control Application webhook (this same endpoint as every other call.* event) —
// the per-call `recording_webhook_url` param record_start accepts is not honored,
// confirmed live (2026-09-17): a clip's `call.recording.saved` arrived here while
// its dedicated /api/voice/telnyx/hold-vehicle-note webhook never received a single
// request. That endpoint (and the voicemail-after-Call-Control path pointing at
// /api/voice/telnyx/recording-status, which really is TeXML-shaped for its OTHER,
// genuinely-TeXML callers) were dead code for every Call Control recording ever
// made — 0 of 7 hold-queue vehicle clips and 0 of 6 voicemails ever resolved.
//
// Two Call Control flows record a clip; the client_state phase at record time tells
// them apart (see startHoldVehicleVoiceRecording / the await_voicemail_prompt_end
// branch in telnyx-call-control-inbound.ts — neither ever set the other's phase):
//   - phase === "recording"          → voicemail after the closed/no-answer greeting
//   - call_queue.collected.vehicle_voice_pending === true → hold-queue Phase-3 clip

import { getCallLogSnapshotForTelemetry, updateCallLog } from "@/lib/db"
import { broadcastCallRecordingReady } from "@/lib/call-telemetry-realtime"
import { VOICEMAIL_ROUTED_TO_NAME, isAutomatedCallHandler } from "@/lib/missed-call-telemetry"
import { getCallQueueCollectedByCallControlId, mergeCallQueueCollected } from "@/lib/call-queue-db"
import { transcribeTelnyxRecording } from "@/lib/transcribe-audio"
import { parseVehicleFromTranscript } from "@/lib/vehicle-transcript-parse"
import { resolveInboundCallLogSid } from "@/lib/telnyx-call-control-call-log"
import type { TelnyxVoiceWebhookEvent } from "@/lib/telnyx-call-control-parse"
import { lyncrLog } from "@/lib/lyncr-env"

async function handleVoicemailRecordingSaved(event: TelnyxVoiceWebhookEvent): Promise<void> {
  const callSid = resolveInboundCallLogSid(event)
  const normalizedUrl = event.recordingUrl
  const snapshot = await getCallLogSnapshotForTelemetry(callSid).catch(() => null)
  // Only demote when this row is already tagged as machine-handled / voicemail.
  const demoteFalseAnswer =
    snapshot?.call_type === "voicemail" ||
    snapshot?.call_type === "missed" ||
    isAutomatedCallHandler(snapshot?.routed_to_name) ||
    Boolean(snapshot?.routed_to_name && /\bvoicemail\b/i.test(snapshot.routed_to_name))

  await updateCallLog(callSid, {
    has_recording: true,
    recording_url: normalizedUrl,
    recording_duration_seconds: event.recordingDurationSeconds,
    ...(demoteFalseAnswer
      ? {
          call_type: (snapshot?.call_type === "missed" ? "missed" : "voicemail") as "missed" | "voicemail",
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
    }).catch((e) => console.warn(lyncrLog("recording-saved-broadcast-failed", { error: String(e) })))
  }
  console.log(lyncrLog("telnyx-cc-voicemail-recording-saved", { callSid, durationSecs: event.recordingDurationSeconds }))
}

async function handleHoldVehicleVoiceRecordingSaved(
  event: TelnyxVoiceWebhookEvent,
  collected: Record<string, unknown>
): Promise<void> {
  const callControlId = event.callControlId
  const transcript = await transcribeTelnyxRecording(event.recordingUrl)
  const parsed = parseVehicleFromTranscript(transcript)
  const label = parsed?.make ? [parsed.make, parsed.model].filter(Boolean).join(" ") : null
  // A keypad-typed year (the deterministic fallback) always wins over a transcribed one.
  const hasYearAlready = typeof collected.vehicle_year === "string" && collected.vehicle_year.trim() !== ""
  const useVoiceYear = Boolean(parsed?.year) && !hasYearAlready

  await mergeCallQueueCollected(callControlId, {
    vehicle_voice_pending: false,
    vehicle_voice_url: event.recordingUrl,
    ...(parsed?.cleaned ? { vehicle_voice_transcript: parsed.cleaned } : {}),
    ...(parsed?.make ? { vehicle_make: parsed.make } : {}),
    ...(parsed?.model ? { vehicle_model: parsed.model } : {}),
    ...(useVoiceYear
      ? {
          vehicle_year: parsed!.year,
          vehicle_year_label: `Year ${parsed!.year}`,
          vehicle_year_source: "voice",
        }
      : {}),
    ...(label ? { vehicle_make_model_label: label } : {}),
  })
  console.log(
    lyncrLog("telnyx-cc-hold-vehicle-note-transcribed", {
      callControlId,
      matchedMake: parsed?.make ?? null,
      matchedYear: parsed?.year ?? null,
      hasTranscript: Boolean(parsed?.cleaned),
    })
  )
}

export async function handleCallRecordingSaved(event: TelnyxVoiceWebhookEvent): Promise<void> {
  if (!event.recordingUrl) return

  try {
    if (event.clientState?.phase === "recording") {
      await handleVoicemailRecordingSaved(event)
      return
    }

    const collected = await getCallQueueCollectedByCallControlId(event.callControlId)
    if (collected.vehicle_voice_pending === true) {
      await handleHoldVehicleVoiceRecordingSaved(event, collected)
    }
  } catch (e) {
    console.error(lyncrLog("telnyx-cc-recording-saved-failed", { callControlId: event.callControlId, error: String(e) }))
  }
}
