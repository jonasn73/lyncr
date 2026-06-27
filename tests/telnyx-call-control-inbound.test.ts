import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { encodeTelnyxCallControlState, decodeTelnyxCallControlState } from "@/lib/telnyx-call-control-state"
import { parseTelnyxVoiceWebhookEvent } from "@/lib/telnyx-call-control-parse"

const getOrCreateCallControlAppMock = vi.hoisted(() =>
  vi.fn(() => Promise.resolve("cc-app-99"))
)

vi.mock("@/lib/telnyx-call-control-config", () => ({
  getOrCreateCallControlApp: getOrCreateCallControlAppMock,
}))

describe("telnyx call control state", () => {
  it("round-trips client_state", () => {
    const raw = encodeTelnyxCallControlState({
      v: 1,
      phase: "await_caller_answered",
      userId: "u1",
      businessLineE164: "+15555571219",
      callerE164: "+15551234567",
      dialTargetE164: "+15552602716",
      ringTimeoutSec: 30,
      fallbackType: "voicemail",
    })
    const decoded = decodeTelnyxCallControlState(raw)
    expect(decoded?.phase).toBe("await_caller_answered")
    expect(decoded?.userId).toBe("u1")
  })
})

describe("parseTelnyxVoiceWebhookEvent", () => {
  it("parses call.initiated envelope", () => {
    const evt = parseTelnyxVoiceWebhookEvent({
      data: {
        event_type: "call.initiated",
        id: "evt-1",
        payload: {
          call_control_id: "cc-in-1",
          call_session_id: "sess-1",
          from: "+15551230000",
          to: "+15555571219",
          direction: "incoming",
        },
      },
    })
    expect(evt?.eventType).toBe("call.initiated")
    expect(evt?.callControlId).toBe("cc-in-1")
    expect(evt?.direction).toBe("incoming")
  })
})

describe("handleTelnyxCallControlVoiceWebhook", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock)
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { call_control_id: "cc-outbound-1" } }),
    })
    getOrCreateCallControlAppMock.mockResolvedValue("cc-app-99")
    vi.stubEnv("ZING_INBOUND_CALL_CONTROL", "1")
    vi.stubEnv("TELNYX_API_KEY", "test-key")
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("call.initiated answers immediately without speak", async () => {
    vi.doMock("@/lib/db", () => ({
      getIncomingRoutingForVoiceWebhook: vi.fn(() =>
        Promise.resolve({
          user_id: "u1",
          business_name: "Key Squad 502",
          organization_name: "Key Squad 502",
          phone_line_label: "Main",
          owner_phone: "+15552602716",
          selected_receptionist_id: null,
          receptionist_phone: null,
          receptionist_name: null,
          fallback_type: "voicemail",
          ring_timeout_seconds: 30,
          inbound_caller_greeting_enabled: true,
          account_status: "active",
        })
      ),
      getRoutingConfigForNumber: vi.fn(),
      insertCallLog: vi.fn(() => Promise.resolve()),
      isReasonablePstnDialString: (s: string) => s.replace(/\D/g, "").length >= 10,
      normalizePhoneNumberE164: (p: string) => {
        const d = p.replace(/\D/g, "")
        if (d.length === 10) return `+1${d}`
        return p.startsWith("+") ? p : `+${d}`
      },
    }))
    vi.doMock("@/lib/call-telemetry-realtime", () => ({
      broadcastCallInitiated: vi.fn(() => Promise.resolve()),
    }))

    const { handleTelnyxCallControlVoiceWebhook } = await import("@/lib/telnyx-call-control-inbound")
    await handleTelnyxCallControlVoiceWebhook({
      data: {
        event_type: "call.initiated",
        id: "evt-init",
        payload: {
          call_control_id: "cc-answer-1",
          from: "+15551230000",
          to: "+15555571219",
          direction: "incoming",
        },
      },
    })

    expect(fetchMock).toHaveBeenCalled()
    const answerCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/actions/answer"))
    expect(answerCall).toBeTruthy()
    const answerBody = JSON.parse(String(answerCall![1].body))
    expect(answerBody.client_state).toBeTruthy()
    expect(decodeTelnyxCallControlState(answerBody.client_state)?.phase).toBe("await_caller_answered")

    const speakCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/actions/speak"))
    expect(speakCall).toBeFalsy()
  })

  it("speak.ended dials outbound leg via POST /v2/calls with link_to", async () => {
    vi.doMock("@/lib/db", () => ({
      getIncomingRoutingForVoiceWebhook: vi.fn(() =>
        Promise.resolve({
          user_id: "u1",
          business_name: "Key Squad 502",
          organization_name: "Key Squad 502",
          phone_line_label: "Main",
          owner_phone: "+15552602716",
          selected_receptionist_id: null,
          receptionist_phone: null,
          receptionist_name: null,
          fallback_type: "voicemail",
          ring_timeout_seconds: 30,
          inbound_caller_greeting_enabled: true,
          account_status: "active",
          primary_phone_number: "+15555571219",
          active_phone_count: 1,
        })
      ),
      getRoutingConfigForNumber: vi.fn(),
      insertCallLog: vi.fn(),
      isReasonablePstnDialString: (s: string) => s.replace(/\D/g, "").length >= 10,
      normalizePhoneNumberE164: (p: string) => {
        const d = p.replace(/\D/g, "")
        if (d.length === 10) return `+1${d}`
        return p.startsWith("+") ? p : `+${d}`
      },
    }))

    const inboundState = encodeTelnyxCallControlState({
      v: 1,
      phase: "await_greeting_end",
      userId: "u1",
      businessLineE164: "+15555571219",
      callerE164: "+15551230000",
      dialTargetE164: "+15552602716",
      ringTimeoutSec: 30,
      fallbackType: "voicemail",
    })

    const { handleTelnyxCallControlVoiceWebhook } = await import("@/lib/telnyx-call-control-inbound")
    await handleTelnyxCallControlVoiceWebhook({
      data: {
        event_type: "call.speak.ended",
        id: "evt-speak-end",
        payload: {
          call_control_id: "cc-inbound-1",
          from: "+15551230000",
          to: "+15555571219",
          direction: "incoming",
          client_state: inboundState,
        },
      },
    })

    const dialCall = fetchMock.mock.calls.find(
      (c) => String(c[0]).includes("/v2/calls") && !String(c[0]).includes("/actions/")
    )
    expect(dialCall).toBeTruthy()
    const dialBody = JSON.parse(String(dialCall![1].body))
    expect(dialBody.connection_id).toBe("cc-app-99")
    expect(dialBody.to).toBe("+15552602716")
    expect(dialBody.link_to).toBe("cc-inbound-1")
    expect(dialBody.bridge_on_answer).toBe(true)
  })

  it("call.answered with empty direction still speaks greeting", async () => {
    vi.doMock("@/lib/db", () => ({
      getIncomingRoutingForVoiceWebhook: vi.fn(() =>
        Promise.resolve({
          user_id: "u1",
          business_name: "Key Squad 502",
          organization_name: "Key Squad 502",
          phone_line_label: "Main",
          owner_phone: "+15552602716",
          selected_receptionist_id: null,
          receptionist_phone: null,
          receptionist_name: null,
          fallback_type: "voicemail",
          ring_timeout_seconds: 30,
          inbound_caller_greeting_enabled: true,
          account_status: "active",
          primary_phone_number: "+15555571219",
          active_phone_count: 1,
        })
      ),
      getRoutingConfigForNumber: vi.fn(),
      insertCallLog: vi.fn(),
      isReasonablePstnDialString: (s: string) => s.replace(/\D/g, "").length >= 10,
      normalizePhoneNumberE164: (p: string) => {
        const d = p.replace(/\D/g, "")
        if (d.length === 10) return `+1${d}`
        return p.startsWith("+") ? p : `+${d}`
      },
    }))

    const answeredState = encodeTelnyxCallControlState({
      v: 1,
      phase: "await_caller_answered",
      userId: "u1",
      businessLineE164: "+15555571219",
      callerE164: "+15551230000",
      dialTargetE164: "+15552602716",
      ringTimeoutSec: 30,
      fallbackType: "voicemail",
    })

    const { handleTelnyxCallControlVoiceWebhook } = await import("@/lib/telnyx-call-control-inbound")
    await handleTelnyxCallControlVoiceWebhook({
      data: {
        event_type: "call.answered",
        id: "evt-answered",
        payload: {
          call_control_id: "cc-inbound-2",
          from: "+15551230000",
          to: "+15555571219",
          direction: "",
          client_state: answeredState,
        },
      },
    })

    const speakCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/actions/speak"))
    expect(speakCall).toBeTruthy()
    const dialCall = fetchMock.mock.calls.find(
      (c) => String(c[0]).includes("/v2/calls") && !String(c[0]).includes("/actions/")
    )
    expect(dialCall).toBeFalsy()
  })
})
