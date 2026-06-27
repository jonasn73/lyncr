import { describe, expect, it } from "vitest"
import {
  isDialNoAnswerHangup,
  isOutboundDialLegEvent,
  parseTelnyxCallDurationFromVoiceEvent,
  resolveInboundCallLogSid,
} from "@/lib/telnyx-call-control-call-log"
import { encodeTelnyxCallControlState } from "@/lib/telnyx-call-control-state"
import type { TelnyxVoiceWebhookEvent } from "@/lib/telnyx-call-control-parse"
import { parseTelnyxCallDurationFromPayload } from "@/lib/telnyx-call-duration"

describe("resolveInboundCallLogSid", () => {
  it("uses inboundCallControlId from outbound leg state", () => {
    const raw = encodeTelnyxCallControlState({
      v: 1,
      phase: "await_dial_end",
      userId: "u1",
      businessLineE164: "+15555571219",
      callerE164: "+15551230000",
      inboundCallControlId: "cc-inbound",
      dialTargetE164: "+15552602716",
    })
    const event: TelnyxVoiceWebhookEvent = {
      eventType: "call.hangup",
      eventId: "e1",
      callControlId: "cc-outbound",
      callSessionId: "sess",
      from: "+15555571219",
      to: "+15552602716",
      direction: "outgoing",
      hangupCause: "normal_clearing",
      dialStatus: "",
      startTime: "",
      endTime: "",
      occurredAt: "",
      callDurationSeconds: 0,
      clientState: JSON.parse(Buffer.from(raw, "base64").toString("utf8")),
    }
    expect(resolveInboundCallLogSid(event)).toBe("cc-inbound")
  })
})

describe("parseTelnyxCallDurationFromPayload", () => {
  it("derives seconds from start_time and end_time", () => {
    const sec = parseTelnyxCallDurationFromPayload({
      start_time: "2026-06-27T19:16:37.000Z",
      end_time: "2026-06-27T19:22:55.000Z",
    })
    expect(sec).toBeGreaterThanOrEqual(370)
    expect(sec).toBeLessThanOrEqual(380)
  })
})

describe("parseTelnyxCallDurationFromVoiceEvent", () => {
  it("prefers call_duration field", () => {
    const sec = parseTelnyxCallDurationFromVoiceEvent({
      eventType: "call.hangup",
      eventId: "e1",
      callControlId: "cc1",
      callSessionId: "",
      from: "",
      to: "",
      direction: "",
      hangupCause: "normal_clearing",
      dialStatus: "",
      startTime: "",
      endTime: "",
      occurredAt: "",
      callDurationSeconds: 142,
      clientState: null,
    })
    expect(sec).toBe(142)
  })
})

describe("isDialNoAnswerHangup", () => {
  it("detects timeout hangup on dial leg", () => {
    expect(
      isDialNoAnswerHangup({
        eventType: "call.hangup",
        eventId: "e1",
        callControlId: "cc-out",
        callSessionId: "",
        from: "",
        to: "",
        direction: "outgoing",
        hangupCause: "timeout",
        dialStatus: "",
        startTime: "",
        endTime: "",
        occurredAt: "",
        callDurationSeconds: 0,
        clientState: null,
      })
    ).toBe(true)
  })
})

describe("isOutboundDialLegEvent", () => {
  it("true when call_control_id differs from inboundCallControlId", () => {
    const raw = encodeTelnyxCallControlState({
      v: 1,
      phase: "await_dial_end",
      userId: "u1",
      businessLineE164: "+15555571219",
      callerE164: "+15551230000",
      inboundCallControlId: "cc-in",
      dialTargetE164: "+15552602716",
    })
    expect(
      isOutboundDialLegEvent({
        eventType: "call.hangup",
        eventId: "e1",
        callControlId: "cc-out",
        callSessionId: "",
        from: "",
        to: "",
        direction: "outgoing",
        hangupCause: "",
        dialStatus: "",
        startTime: "",
        endTime: "",
        occurredAt: "",
        callDurationSeconds: 0,
        clientState: JSON.parse(Buffer.from(raw, "base64").toString("utf8")),
      })
    ).toBe(true)
  })
})
