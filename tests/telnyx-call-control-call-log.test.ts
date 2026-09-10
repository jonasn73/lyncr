import { describe, expect, it } from "vitest"
import {
  isDialNoAnswerHangup,
  isOutboundDialLegEvent,
  parseTelnyxCallDurationFromVoiceEvent,
  resolveInboundCallLogSid,
  resolveRoutedToLabel,
} from "@/lib/telnyx-call-control-call-log"
import { encodeTelnyxCallControlState } from "@/lib/telnyx-call-control-state"
import type { TelnyxCallControlClientState } from "@/lib/telnyx-call-control-state"
import type { TelnyxVoiceWebhookEvent } from "@/lib/telnyx-call-control-parse"
import { parseTelnyxCallDurationFromPayload } from "@/lib/telnyx-call-duration"
import type { IncomingRoutingRow } from "@/lib/db"

const baseRouting: IncomingRoutingRow = {
  user_id: "u1",
  user_name: "Jonas",
  business_name: "Key Squad 502",
  inbound_receptionist_whisper_enabled: false,
  owner_phone: "+15022602716",
  selected_receptionist_id: null,
  fallback_type: "hold",
  ring_timeout_seconds: 30,
  ai_ring_owner_first: false,
  inbound_caller_greeting_enabled: true,
  forward_original_caller_id: false,
  receptionist_name: null,
  receptionist_phone: null,
  receptionist_routing_endpoint: "CELL",
  receptionist_sip_username: null,
  phone_line_label: "Main",
  phone_line_friendly_name: "+15025571219",
  account_status: "active",
  active_phone_count: 1,
  primary_phone_number: "+15025571219",
  admin_routing_override_phone: null,
  organization_name: "Key Squad 502",
}

const baseState: TelnyxCallControlClientState = {
  v: 1,
  phase: "await_dial_end",
  userId: "u1",
  businessLineE164: "+15025571219",
  callerE164: "+15551230000",
}

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
      // Always present on a parsed event ("" when the payload omits them).
      digits: "",
      gatherStatus: "",
      amdResult: "",
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
      // Always present on a parsed event ("" when the payload omits them).
      digits: "",
      gatherStatus: "",
      amdResult: "",
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
        // Always present on a parsed event ("" when the payload omits them).
        digits: "",
        gatherStatus: "",
        amdResult: "",
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
        // Always present on a parsed event ("" when the payload omits them).
        digits: "",
        gatherStatus: "",
        amdResult: "",
        clientState: JSON.parse(Buffer.from(raw, "base64").toString("utf8")),
      })
    ).toBe(true)
  })
})

describe("resolveRoutedToLabel", () => {
  it("labels an on-call tech bridge with the tech's name, not Owner (166 regression guard)", () => {
    const state: TelnyxCallControlClientState = {
      ...baseState,
      dialReason: "oncall_tech",
      technicianId: "tech-jordan",
      technicianName: "Jordan",
    }
    expect(resolveRoutedToLabel(baseRouting, state)).toBe("Jordan")
  })

  it("labels a receptionist bridge with the receptionist's name", () => {
    const routing: IncomingRoutingRow = {
      ...baseRouting,
      selected_receptionist_id: "recv-alex",
      receptionist_name: "Alex Jonas",
    }
    const state: TelnyxCallControlClientState = { ...baseState, dialReason: "busy_backup_recv" }
    expect(resolveRoutedToLabel(routing, state)).toBe("Alex Jonas")
  })

  it("falls back to Owner when neither a tech nor a receptionist is routed", () => {
    expect(resolveRoutedToLabel(baseRouting, baseState)).toBe("Owner")
  })

  it("falls back to Owner when technicianName is missing despite dialReason oncall_tech", () => {
    const state: TelnyxCallControlClientState = {
      ...baseState,
      dialReason: "oncall_tech",
      technicianId: "tech-jordan",
    }
    expect(resolveRoutedToLabel(baseRouting, state)).toBe("Owner")
  })
})
