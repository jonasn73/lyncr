import { describe, expect, it } from "vitest"
import { isMissedCallRecord } from "@/lib/missed-call-telemetry"
import { isMissedCallTelemetry } from "@/lib/realtime/owner-call-event-types"

describe("isMissedCallRecord", () => {
  it("counts explicit missed and voicemail rows", () => {
    expect(isMissedCallRecord({ call_type: "missed", status: "canceled" })).toBe(true)
    expect(isMissedCallRecord({ call_type: "voicemail", status: "completed" })).toBe(true)
  })

  it("counts terminal statuses even when call_type is still incoming", () => {
    expect(isMissedCallRecord({ call_type: "incoming", status: "no-answer" })).toBe(true)
    expect(isMissedCallRecord({ call_type: "incoming", status: "canceled" })).toBe(true)
  })

  it("counts completed inbound rows that never got answered_at", () => {
    expect(
      isMissedCallRecord({
        call_type: "incoming",
        status: "completed",
        answered_at: null,
      })
    ).toBe(true)
  })

  it("does not count live answered conversations", () => {
    expect(
      isMissedCallRecord({
        call_type: "incoming",
        status: "completed",
        answered_at: "2026-06-27T17:00:00.000Z",
      })
    ).toBe(false)
  })
})

describe("isMissedCallTelemetry", () => {
  it("matches Pusher payloads to the same missed rules", () => {
    expect(
      isMissedCallTelemetry({
        call_sid: "abc",
        call_type: "voicemail",
        status: "completed",
      })
    ).toBe(true)
    expect(
      isMissedCallTelemetry({
        call_sid: "abc",
        call_type: "incoming",
        status: "completed",
        answered_at: null,
      })
    ).toBe(true)
    expect(
      isMissedCallTelemetry({
        call_sid: "abc",
        call_type: "incoming",
        status: "completed",
        answered_at: "2026-06-27T17:00:00.000Z",
      })
    ).toBe(false)
  })
})
