import { describe, expect, it } from "vitest"
import {
  intakeCallBadgeLabel,
  intakeCallHeaderLabel,
  resolveIntakeCallLinePhase,
} from "@/lib/intake-call-line-phase"
import { isMissedCallRecord } from "@/lib/missed-call-telemetry"

describe("resolveIntakeCallLinePhase", () => {
  it("keeps ringing until answered_at lands", () => {
    expect(
      resolveIntakeCallLinePhase({
        manualCallStatus: "ringing",
        answered_at: null,
        call_type: "incoming",
        status: "ringing",
      })
    ).toBe("ringing")
    expect(intakeCallHeaderLabel("ringing")).toBe("Incoming call")
    expect(intakeCallBadgeLabel("ringing")).toBe("Ringing")
  })

  it("shows Answered only for a live human pickup", () => {
    expect(
      resolveIntakeCallLinePhase({
        manualCallStatus: "answered",
        answered_at: "2026-07-30T12:00:00.000Z",
        call_type: "incoming",
        status: "in-progress",
        routed_to_name: "Owner",
      })
    ).toBe("answered")
    expect(intakeCallHeaderLabel("answered")).toBe("Call answered")
    expect(intakeCallBadgeLabel("answered")).toBe("Answered")
  })

  it("labels Lyncr voicemail even when cell-VM stamped answered_at", () => {
    expect(
      resolveIntakeCallLinePhase({
        manualCallStatus: "answered",
        answered_at: "2026-07-30T12:00:00.000Z",
        call_type: "voicemail",
        status: "in-progress",
        routed_to_name: "Voicemail",
      })
    ).toBe("voicemail")
    expect(intakeCallHeaderLabel("voicemail")).toBe("Voicemail")
    expect(intakeCallBadgeLabel("voicemail")).toBe("Voicemail")
  })

  it("labels missed / AI after hangup", () => {
    expect(
      resolveIntakeCallLinePhase({
        manualCallStatus: "completed",
        answered_at: null,
        ended_at: "2026-07-30T12:01:00.000Z",
        call_type: "missed",
        status: "no-answer",
      })
    ).toBe("missed")
    expect(
      resolveIntakeCallLinePhase({
        answered_at: null,
        ended_at: "2026-07-30T12:01:00.000Z",
        call_type: "incoming",
        status: "completed",
        routed_to_name: "AI Receptionist",
      })
    ).toBe("missed")
  })

  it("shows Ended for a real human conversation that hung up", () => {
    expect(
      resolveIntakeCallLinePhase({
        manualCallStatus: "completed",
        answered_at: "2026-07-30T12:00:00.000Z",
        ended_at: "2026-07-30T12:02:00.000Z",
        call_type: "incoming",
        status: "completed",
        routed_to_name: "Owner",
        duration_seconds: 120,
      })
    ).toBe("ended")
  })
})

describe("isMissedCallRecord voicemail vs false answered_at", () => {
  it("treats call_type=voicemail as missed even with answered_at + long duration", () => {
    expect(
      isMissedCallRecord({
        call_type: "voicemail",
        status: "completed",
        answered_at: "2026-07-30T12:00:00.000Z",
        ended_at: "2026-07-30T12:01:30.000Z",
        duration_seconds: 90,
        routed_to_name: "Owner",
      })
    ).toBe(true)
  })
})
