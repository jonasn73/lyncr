import { describe, expect, it } from "vitest"
import { isMissedCallRecord, isMissedCallTodayRecord } from "@/lib/missed-call-telemetry"
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

  it("counts completed inbound rows that never got bridged to owner", () => {
    expect(
      isMissedCallRecord({
        call_type: "incoming",
        status: "completed",
        answered_at: "2026-07-01T03:33:41.866Z",
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

  it("does not count live answered conversations", () => {
    expect(
      isMissedCallRecord({
        call_type: "incoming",
        status: "completed",
        answered_at: "2026-06-27T17:00:00.000Z",
        ended_at: "2026-06-27T17:01:11.000Z",
        routed_to_name: "Owner",
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
        answered_at: "2026-07-01T03:33:41.866Z",
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
