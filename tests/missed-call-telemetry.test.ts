import { describe, expect, it } from "vitest"
import { isMissedCallRecord, isMissedCallTodayRecord } from "@/lib/missed-call-telemetry"
import { isMissedCallTelemetry } from "@/lib/realtime/owner-call-event-types"

describe("isMissedCallRecord", () => {
  it("counts explicit missed and voicemail rows without answered_at", () => {
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
        ended_at: "2026-07-01T03:33:41.866Z",
        routed_to_name: null,
      })
    ).toBe(true)
  })

  it("counts completed inbound rows preset with Owner but never bridged", () => {
    expect(
      isMissedCallRecord({
        call_type: "incoming",
        status: "completed",
        routed_to_name: "Owner",
      })
    ).toBe(true)
  })

  it("does not count live answered conversations — including short-but-real pickups", () => {
    expect(
      isMissedCallRecord({
        call_type: "incoming",
        status: "completed",
        answered_at: "2026-06-27T17:00:00.000Z",
        ended_at: "2026-06-27T17:01:11.000Z",
        routed_to_name: "Owner",
      })
    ).toBe(false)
    // 6-second Your Phone answer must stay Answered (not Missed).
    expect(
      isMissedCallRecord({
        call_type: "incoming",
        status: "completed",
        answered_at: "2026-07-13T14:42:04.000Z",
        ended_at: "2026-07-13T14:42:10.000Z",
        duration_seconds: 6,
        routed_to_name: "Owner",
      })
    ).toBe(false)
    // answered_at wins even if call_type was wrongly stamped missed.
    expect(
      isMissedCallRecord({
        call_type: "missed",
        status: "completed",
        answered_at: "2026-07-13T14:42:04.000Z",
        ended_at: "2026-07-13T14:42:10.000Z",
        duration_seconds: 6,
        routed_to_name: "Owner",
      })
    ).toBe(false)
  })

  it("counts sub-5s completed legs as missed (anti-voicemail / aborted connect)", () => {
    expect(
      isMissedCallRecord({
        call_type: "incoming",
        status: "completed",
        answered_at: "2026-07-01T03:33:41.866Z",
        ended_at: "2026-07-01T03:33:44.866Z",
        duration_seconds: 3,
        routed_to_name: "Owner",
      })
    ).toBe(true)
    expect(
      isMissedCallRecord({
        call_type: "incoming",
        status: "completed",
        answered_at: "2026-07-01T03:33:41.866Z",
        ended_at: "2026-07-01T03:33:41.866Z",
        duration_seconds: 0,
        routed_to_name: "Owner",
      })
    ).toBe(true)
    expect(
      isMissedCallRecord({
        call_type: "incoming",
        status: "busy",
        duration_seconds: 2,
      })
    ).toBe(true)
  })

  it("counts IVR / automated handlers as missed even with carrier answered_at", () => {
    expect(
      isMissedCallRecord({
        call_type: "incoming",
        status: "completed",
        answered_at: "2026-07-13T13:33:00.000Z",
        ended_at: "2026-07-13T13:34:30.000Z",
        routed_to_name: "IVR Menu",
      })
    ).toBe(true)
    expect(
      isMissedCallRecord({
        call_type: "incoming",
        status: "completed",
        answered_at: "2026-07-13T13:33:00.000Z",
        ended_at: "2026-07-13T13:34:30.000Z",
        routed_to_name: "AI Receptionist",
      })
    ).toBe(true)
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
        ended_at: "2026-07-01T03:33:41.866Z",
        routed_to_name: null,
      })
    ).toBe(true)
    expect(
      isMissedCallTelemetry({
        call_sid: "abc",
        call_type: "incoming",
        status: "completed",
        answered_at: "2026-06-27T17:00:00.000Z",
        ended_at: "2026-06-27T17:01:11.000Z",
        routed_to_name: "Owner",
      })
    ).toBe(false)
  })
})

describe("isMissedCallTodayRecord", () => {
  it("requires local calendar day and missed rules", () => {
    const now = new Date("2026-07-04T17:00:00-04:00")
    expect(
      isMissedCallTodayRecord(
        {
          call_type: "missed",
          status: "canceled",
          created_at: "2026-07-04T14:00:00-04:00",
        },
        now
      )
    ).toBe(true)
    expect(
      isMissedCallTodayRecord(
        {
          call_type: "missed",
          status: "canceled",
          created_at: "2026-07-03T14:00:00-04:00",
        },
        now
      )
    ).toBe(false)
  })
})
