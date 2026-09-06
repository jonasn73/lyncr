import { describe, expect, it } from "vitest"
import {
  shouldOpenOwnerAnsweredIntake,
  shouldOpenOwnerRingingIntake,
} from "@/lib/realtime/owner-call-event-types"
import { isMissedCallRecord, ownerLiveAnswered } from "@/lib/missed-call-telemetry"
import {
  CAPTURE_STATUS_BUSY_MENU,
  CAPTURE_STATUS_HOLD_PRESS1,
  CAPTURE_STATUS_HOLD_QUEUE,
  CAPTURE_STATUS_ANSWERED_FROM_QUEUE,
} from "@/lib/inbound-time-capture"
import { resolveIntakeCallLinePhase } from "@/lib/intake-call-line-phase"

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

  it("a receptionist's own console opens for her own routed ring", () => {
    expect(
      shouldOpenOwnerRingingIntake(
        {
          routed_to_receptionist_id: "recv-1",
          routed_to_name: "Alex",
          dial_reason: "day_dial",
        },
        "recv-1"
      )
    ).toBe(true)
  })

  it("a receptionist's own console ignores a ring routed to someone else", () => {
    expect(
      shouldOpenOwnerRingingIntake(
        {
          routed_to_receptionist_id: "recv-2",
          routed_to_name: "Someone Else",
          dial_reason: "day_dial",
        },
        "recv-1"
      )
    ).toBe(false)
  })

  it("a receptionist's own console ignores the owner's own unrouted ring", () => {
    expect(
      shouldOpenOwnerRingingIntake(
        {
          routed_to_name: "Owner",
          dial_reason: "day_dial",
        },
        "recv-1"
      )
    ).toBe(false)
  })

  it("a receptionist's own console still suppresses Busy → hold automation for her call", () => {
    expect(
      shouldOpenOwnerRingingIntake(
        {
          routed_to_receptionist_id: "recv-1",
          routed_to_name: CAPTURE_STATUS_BUSY_MENU,
          dial_reason: "busy_automation",
        },
        "recv-1"
      )
    ).toBe(false)
  })
})

describe("shouldOpenOwnerAnsweredIntake", () => {
  it("opens for normal owner bridge", () => {
    expect(
      shouldOpenOwnerAnsweredIntake({
        routed_to_name: "Owner",
        dial_reason: "day_dial",
      })
    ).toBe(true)
  })

  it("suppresses soft-hold waiting (Hold Queue)", () => {
    expect(
      shouldOpenOwnerAnsweredIntake({
        routed_to_name: CAPTURE_STATUS_HOLD_QUEUE,
        dial_reason: "busy_automation",
      })
    ).toBe(false)
  })

  it("suppresses Busy menu without dial_reason", () => {
    expect(
      shouldOpenOwnerAnsweredIntake({
        routed_to_name: CAPTURE_STATUS_BUSY_MENU,
        dial_reason: null,
      })
    ).toBe(false)
  })

  it("opens after Lines Answer (queue_answer / Answered from queue)", () => {
    expect(
      shouldOpenOwnerAnsweredIntake({
        routed_to_name: CAPTURE_STATUS_ANSWERED_FROM_QUEUE,
        dial_reason: "queue_answer",
      })
    ).toBe(true)
    expect(
      shouldOpenOwnerAnsweredIntake({
        routed_to_name: CAPTURE_STATUS_ANSWERED_FROM_QUEUE,
        dial_reason: null,
      })
    ).toBe(true)
  })

  it("the owner's own console still opens for a call answered by a receptionist", () => {
    // No viewerReceptionistId (owner's own console) — original account-wide behavior,
    // unchanged: the owner sees every answered call, whoever it went to.
    expect(
      shouldOpenOwnerAnsweredIntake({
        routed_to_receptionist_id: "recv-1",
        routed_to_name: "Alex",
        dial_reason: "day_dial",
      })
    ).toBe(true)
  })

  it("a receptionist's own console opens only for her own answered call", () => {
    expect(
      shouldOpenOwnerAnsweredIntake(
        {
          routed_to_receptionist_id: "recv-1",
          routed_to_name: "Alex",
          dial_reason: "day_dial",
        },
        "recv-1"
      )
    ).toBe(true)
  })

  it("a receptionist's own console ignores another receptionist's answered call", () => {
    expect(
      shouldOpenOwnerAnsweredIntake(
        {
          routed_to_receptionist_id: "recv-2",
          routed_to_name: "Someone Else",
          dial_reason: "day_dial",
        },
        "recv-1"
      )
    ).toBe(false)
  })

  it("a receptionist's own console ignores the owner's own answered call", () => {
    expect(
      shouldOpenOwnerAnsweredIntake(
        {
          routed_to_name: "Owner",
          dial_reason: "day_dial",
        },
        "recv-1"
      )
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

  it("Hold Queue with a false answered_at is not a live owner answer", () => {
    expect(
      ownerLiveAnswered({
        call_type: "incoming",
        status: "in-progress",
        routed_to_name: CAPTURE_STATUS_HOLD_QUEUE,
        answered_at: "2026-08-09T18:00:00.000Z",
        duration_seconds: 120,
      })
    ).toBe(false)
    expect(
      resolveIntakeCallLinePhase({
        call_type: "incoming",
        status: "in-progress",
        routed_to_name: CAPTURE_STATUS_HOLD_QUEUE,
        answered_at: "2026-08-09T18:00:00.000Z",
      })
    ).toBe("ringing")
  })
})
