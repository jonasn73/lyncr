import { describe, expect, it } from "vitest"
import { shouldOpenOwnerRingingIntake } from "@/lib/realtime/owner-call-event-types"
import { isMissedCallRecord } from "@/lib/missed-call-telemetry"
import {
  CAPTURE_STATUS_BUSY_MENU,
  CAPTURE_STATUS_HOLD_PRESS1,
  CAPTURE_STATUS_HOLD_QUEUE,
  CAPTURE_STATUS_ANSWERED_FROM_QUEUE,
} from "@/lib/inbound-time-capture"

describe("shouldOpenOwnerRingingIntake", () => {
  it("opens for owner-cell ring", () => {
    expect(
      shouldOpenOwnerRingingIntake({
        routed_to_name: "Owner",
        dial_reason: "day_dial",
      })
    ).toBe(true)
  })

  it("suppresses Busy → hold automation", () => {
    expect(
      shouldOpenOwnerRingingIntake({
        routed_to_name: CAPTURE_STATUS_BUSY_MENU,
        dial_reason: "busy_automation",
      })
    ).toBe(false)
  })

  it("suppresses teammate Dial", () => {
    expect(
      shouldOpenOwnerRingingIntake({
        routed_to_receptionist_id: "recv-1",
        routed_to_name: "Alex",
        dial_reason: "busy_backup_recv",
      })
    ).toBe(false)
  })
})

describe("hold path is not a classic miss", () => {
  it("Hold Queue / Press 1 / Busy menu are not missed", () => {
    expect(
      isMissedCallRecord({
        call_type: "incoming",
        status: "completed",
        routed_to_name: CAPTURE_STATUS_HOLD_QUEUE,
        duration_seconds: 440,
      })
    ).toBe(false)
    expect(
      isMissedCallRecord({
        call_type: "missed",
        status: "canceled",
        routed_to_name: CAPTURE_STATUS_HOLD_PRESS1,
      })
    ).toBe(false)
    expect(
      isMissedCallRecord({
        call_type: "incoming",
        status: "completed",
        routed_to_name: CAPTURE_STATUS_BUSY_MENU,
      })
    ).toBe(false)
  })

  it("Answered from queue with answered_at is not missed", () => {
    expect(
      isMissedCallRecord({
        call_type: "incoming",
        status: "completed",
        routed_to_name: CAPTURE_STATUS_ANSWERED_FROM_QUEUE,
        answered_at: "2026-08-09T18:00:00.000Z",
        duration_seconds: 90,
      })
    ).toBe(false)
  })
})
