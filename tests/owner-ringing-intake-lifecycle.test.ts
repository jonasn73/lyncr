import { describe, expect, it } from "vitest"
import {
  CAPTURE_STATUS_ANSWERED_FROM_QUEUE,
  CAPTURE_STATUS_BUSY_MENU,
  CAPTURE_STATUS_HOLD_PRESS1,
  CAPTURE_STATUS_HOLD_QUEUE,
} from "@/lib/inbound-time-capture"
import {
  isRingingOnlyIntakeRow,
  openIntakeMatchesCallLeg,
  shouldAutoDismissIntakeOnCallCompleted,
  shouldDismissOpenRingingIntakeForAutomation,
  shouldDismissRingingIntakeAfterPollMiss,
} from "@/lib/owner-ringing-intake-lifecycle"

describe("owner-ringing-intake-lifecycle", () => {
  it("treats RINGING chrome as ringing-only", () => {
    expect(
      isRingingOnlyIntakeRow({
        id: "c1",
        manualCallStatus: "ringing",
        answered_at: null,
      })
    ).toBe(true)
  })

  it("does not treat live Answer as ringing-only", () => {
    expect(
      isRingingOnlyIntakeRow({
        id: "c1",
        manualCallStatus: "answered",
        answered_at: "2026-08-11T12:00:00.000Z",
        routed_to_name: "Owner",
      })
    ).toBe(false)
  })

  it("still treats Hold Queue waiters as ringing-only even with false answered_at", () => {
    expect(
      isRingingOnlyIntakeRow({
        id: "c1",
        manualCallStatus: "answered",
        answered_at: "2026-08-11T12:00:00.000Z",
        routed_to_name: CAPTURE_STATUS_HOLD_QUEUE,
      })
    ).toBe(true)
  })

  it("matches open sheet by call log id, ring alias, or phone", () => {
    expect(
      openIntakeMatchesCallLeg(
        { id: "11111111-1111-4111-8111-111111111111", from_number: "+15024500802" },
        { call_log_id: "11111111-1111-4111-8111-111111111111" }
      )
    ).toBe(true)
    expect(
      openIntakeMatchesCallLeg(
        { id: "ring-abc", from_number: "+15024500802" },
        { call_sid: "abc" }
      )
    ).toBe(true)
    expect(
      openIntakeMatchesCallLeg(
        { id: "ring-other", from_number: "(502) 450-0802" },
        { from_number: "+15024500802" }
      )
    ).toBe(true)
  })

  it("dismisses open RINGING when Busy / Hold automation owns the leg", () => {
    expect(
      shouldDismissOpenRingingIntakeForAutomation({
        routed_to_name: CAPTURE_STATUS_HOLD_QUEUE,
        dial_reason: "busy_automation",
      })
    ).toBe(true)
    expect(
      shouldDismissOpenRingingIntakeForAutomation({
        routed_to_name: CAPTURE_STATUS_BUSY_MENU,
        dial_reason: "busy_automation",
      })
    ).toBe(true)
    expect(
      shouldDismissOpenRingingIntakeForAutomation({
        routed_to_name: "Owner",
        dial_reason: "day_dial",
      })
    ).toBe(false)
  })

  it("auto-dismisses hangup while still RINGING / on hold waiter", () => {
    expect(
      shouldAutoDismissIntakeOnCallCompleted(
        { id: "c1", manualCallStatus: "ringing", answered_at: null },
        { routed_to_name: "Owner" }
      )
    ).toBe(true)
    expect(
      shouldAutoDismissIntakeOnCallCompleted(
        {
          id: "c1",
          manualCallStatus: "ringing",
          answered_at: null,
          routed_to_name: CAPTURE_STATUS_HOLD_QUEUE,
        },
        { routed_to_name: CAPTURE_STATUS_HOLD_PRESS1 }
      )
    ).toBe(true)
  })

  it("keeps post-call intake after a real human Answer hangup", () => {
    expect(
      shouldAutoDismissIntakeOnCallCompleted(
        {
          id: "c1",
          manualCallStatus: "answered",
          answered_at: "2026-08-11T12:00:00.000Z",
          routed_to_name: "Owner",
        },
        { routed_to_name: "Owner", answered_at: "2026-08-11T12:00:00.000Z" }
      )
    ).toBe(false)
    expect(
      shouldAutoDismissIntakeOnCallCompleted(
        {
          id: "c1",
          manualCallStatus: "answered",
          answered_at: "2026-08-11T12:00:00.000Z",
          routed_to_name: CAPTURE_STATUS_ANSWERED_FROM_QUEUE,
        },
        { routed_to_name: CAPTURE_STATUS_ANSWERED_FROM_QUEUE }
      )
    ).toBe(false)
  })

  it("poll miss dismisses only on hold/terminal — not while still dialing", () => {
    expect(
      shouldDismissRingingIntakeAfterPollMiss({
        open: { id: "c1", manualCallStatus: "ringing", answered_at: null },
        stillRinging: false,
        upgradingToAnswered: false,
        routedToName: CAPTURE_STATUS_HOLD_QUEUE,
        status: "in-progress",
      })
    ).toBe(true)
    expect(
      shouldDismissRingingIntakeAfterPollMiss({
        open: { id: "c1", manualCallStatus: "ringing", answered_at: null },
        stillRinging: true,
        upgradingToAnswered: false,
      })
    ).toBe(false)
    expect(
      shouldDismissRingingIntakeAfterPollMiss({
        open: { id: "c1", manualCallStatus: "ringing", answered_at: null },
        stillRinging: false,
        upgradingToAnswered: true,
      })
    ).toBe(false)
    // Left ringing-recent but status still ringing (cell dialing) — keep Incoming Call open.
    expect(
      shouldDismissRingingIntakeAfterPollMiss({
        open: { id: "c1", manualCallStatus: "ringing", answered_at: null },
        stillRinging: false,
        upgradingToAnswered: false,
        status: "ringing",
        routedToName: "Owner",
      })
    ).toBe(false)
    // Missing summary / unknown — do not close on a transient empty poll.
    expect(
      shouldDismissRingingIntakeAfterPollMiss({
        open: { id: "c1", manualCallStatus: "ringing", answered_at: null },
        stillRinging: false,
        upgradingToAnswered: false,
      })
    ).toBe(false)
    // Failed ringing-recent fetch must never dismiss mid-ring.
    expect(
      shouldDismissRingingIntakeAfterPollMiss({
        open: { id: "c1", manualCallStatus: "ringing", answered_at: null },
        stillRinging: false,
        upgradingToAnswered: false,
        ringingLookupOk: false,
        routedToName: CAPTURE_STATUS_HOLD_QUEUE,
        status: "in-progress",
      })
    ).toBe(false)
    // Terminal miss after dial timeout — dismiss.
    expect(
      shouldDismissRingingIntakeAfterPollMiss({
        open: { id: "c1", manualCallStatus: "ringing", answered_at: null },
        stillRinging: false,
        upgradingToAnswered: false,
        status: "no-answer",
      })
    ).toBe(true)
  })
})
