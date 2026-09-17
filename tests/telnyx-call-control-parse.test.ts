import { describe, expect, it } from "vitest"
import { parseTelnyxVoiceWebhookEvent } from "@/lib/telnyx-call-control-parse"

describe("parseTelnyxVoiceWebhookEvent recording fields", () => {
  it("extracts the mp3 url from recording_urls on call.recording.saved", () => {
    const event = parseTelnyxVoiceWebhookEvent({
      data: {
        event_type: "call.recording.saved",
        id: "evt1",
        occurred_at: "2026-09-17T03:04:22.000Z",
        payload: {
          call_control_id: "cc1",
          recording_urls: { mp3: "https://api.telnyx.com/recordings/abc.mp3", wav: "https://api.telnyx.com/recordings/abc.wav" },
          recording_started_at: "2026-09-17T03:04:15.000Z",
          recording_ended_at: "2026-09-17T03:04:21.000Z",
        },
      },
    })
    expect(event?.recordingUrl).toBe("https://api.telnyx.com/recordings/abc.mp3")
    expect(event?.recordingDurationSeconds).toBe(6)
  })

  it("falls back to public_recording_urls when recording_urls is absent", () => {
    const event = parseTelnyxVoiceWebhookEvent({
      data: {
        event_type: "call.recording.saved",
        id: "evt2",
        payload: {
          call_control_id: "cc2",
          public_recording_urls: { mp3: "https://public.example/clip.mp3" },
        },
      },
    })
    expect(event?.recordingUrl).toBe("https://public.example/clip.mp3")
  })

  it("leaves recordingUrl empty and duration at 0 for events with no recording payload", () => {
    const event = parseTelnyxVoiceWebhookEvent({
      data: {
        event_type: "call.hangup",
        id: "evt3",
        payload: { call_control_id: "cc3" },
      },
    })
    expect(event?.recordingUrl).toBe("")
    expect(event?.recordingDurationSeconds).toBe(0)
  })
})
