import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { encodeTelnyxCallControlState, decodeTelnyxCallControlState } from "@/lib/telnyx-call-control-state"
import { parseTelnyxVoiceWebhookEvent } from "@/lib/telnyx-call-control-parse"

const getOrCreateCallControlAppMock = vi.hoisted(() =>
  vi.fn(() => Promise.resolve("cc-app-99"))
)

const getActiveRoutingModeForDidMock = vi.hoisted(() =>
  vi.fn(() => Promise.resolve("your_phone"))
)
const getFirstAvailableOwnerReceptionistMock = vi.hoisted(() =>
  vi.fn(() => Promise.resolve(null))
)
const getCustomRoutingPhoneForDidMock = vi.hoisted(() =>
  vi.fn(() => Promise.resolve(null))
)
const getTeamReceptionistForDidMock = vi.hoisted(() =>
  vi.fn(() => Promise.resolve(null))
)
const resolveInboundCapturePlanMock = vi.hoisted(() =>
  vi.fn(() => Promise.resolve({ kind: "day_dial" as const }))
)

vi.mock("@/lib/telnyx-call-control-config", () => ({
  getOrCreateCallControlApp: getOrCreateCallControlAppMock,
}))

vi.mock("@/lib/active-routing-mode-db", () => ({
  getActiveRoutingModeForDid: getActiveRoutingModeForDidMock,
  getCustomRoutingPhoneForDid: getCustomRoutingPhoneForDidMock,
  getFirstAvailableOwnerReceptionist: getFirstAvailableOwnerReceptionistMock,
  getTeamReceptionistForDid: getTeamReceptionistForDidMock,
}))

vi.mock("@/lib/inbound-time-capture", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inbound-time-capture")>()
  return {
    ...actual,
    resolveInboundCapturePlan: resolveInboundCapturePlanMock,
  }
})

vi.mock("@/lib/account-presence", () => ({
  getAccountPresence: vi.fn(() =>
    Promise.resolve({
      presenceStatus: "ON_JOB",
      presenceClosedManual: true,
      onJobGreetingText: "We're on a job. Press 1 to get a booking link by text, or stay on the line.",
      closedGreetingText: "We're closed.",
      ivrBypassCode: null,
    })
  ),
  resolvePresenceAutomationGreeting: vi.fn(() =>
    "We're on a job. Press 1 to get a booking link by text, or stay on the line."
  ),
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
    getActiveRoutingModeForDidMock.mockResolvedValue("your_phone")
    getFirstAvailableOwnerReceptionistMock.mockResolvedValue(null)
    getCustomRoutingPhoneForDidMock.mockResolvedValue(null)
    getTeamReceptionistForDidMock.mockResolvedValue(null)
    resolveInboundCapturePlanMock.mockResolvedValue({ kind: "day_dial" })
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

  it("speak.ended dials Available receptionist when owner is Busy (ON_JOB)", async () => {
    // Presence Busy + Alex Available → Dial …5874, never owner …2716.
    resolveInboundCapturePlanMock.mockResolvedValue({ kind: "presence_on_job" })
    getFirstAvailableOwnerReceptionistMock.mockResolvedValue({
      receptionistId: "recv-alex",
      name: "Alex Jonas",
      phoneE164: "+15029995874",
    })

    vi.doMock("@/lib/db", () => ({
      getIncomingRoutingForVoiceWebhook: vi.fn(() =>
        Promise.resolve({
          user_id: "u1",
          business_name: "Key Squad 502",
          organization_name: "Key Squad 502",
          phone_line_label: "Main",
          owner_phone: "+15022602716",
          selected_receptionist_id: null,
          receptionist_phone: null,
          receptionist_name: null,
          fallback_type: "voicemail",
          ring_timeout_seconds: 30,
          inbound_caller_greeting_enabled: true,
          account_status: "active",
          primary_phone_number: "+15025571219",
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
      businessLineE164: "+15025571219",
      callerE164: "+15025369252",
      dialTargetE164: "+15022602716",
      ringTimeoutSec: 30,
      fallbackType: "voicemail",
    })

    const { handleTelnyxCallControlVoiceWebhook } = await import("@/lib/telnyx-call-control-inbound")
    await handleTelnyxCallControlVoiceWebhook({
      data: {
        event_type: "call.speak.ended",
        id: "evt-speak-busy-backup",
        payload: {
          call_control_id: "cc-inbound-busy",
          from: "+15025369252",
          to: "+15025571219",
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
    expect(dialBody.to).toBe("+15029995874")
    expect(dialBody.to).not.toBe("+15022602716")
    expect(dialBody.link_to).toBe("cc-inbound-busy")
  })

  it("speak.ended still dials when client_state phase was overwritten to await_caller_answered", async () => {
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

    // Production race: late client_state refine overwrote await_greeting_end.
    const staleState = encodeTelnyxCallControlState({
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
        event_type: "call.speak.ended",
        id: "evt-speak-end-stale",
        payload: {
          call_control_id: "cc-inbound-stale",
          from: "+15551230000",
          to: "+15555571219",
          direction: "incoming",
          client_state: staleState,
        },
      },
    })

    const dialCall = fetchMock.mock.calls.find(
      (c) => String(c[0]).includes("/v2/calls") && !String(c[0]).includes("/actions/")
    )
    expect(dialCall).toBeTruthy()
    const dialBody = JSON.parse(String(dialCall![1].body))
    expect(dialBody.to).toBe("+15552602716")
    expect(dialBody.link_to).toBe("cc-inbound-stale")
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

  it("call.initiated still answers when routing DB throws", async () => {
    vi.doMock("@/lib/db", () => ({
      getIncomingRoutingForVoiceWebhook: vi.fn(() =>
        Promise.reject(new Error("column rc_spec.forward_original_caller_id does not exist"))
      ),
      getActivePhoneNumberByE164: vi.fn(() =>
        Promise.resolve({
          user_id: "u1",
          number: "+15025571219",
          organization_id: "org-1",
        })
      ),
      getRoutingConfigForNumber: vi.fn(),
      insertCallLog: vi.fn(() => Promise.resolve("log-1")),
      isReasonablePstnDialString: (s: string) => s.replace(/\D/g, "").length >= 10,
      normalizePhoneNumberE164: (p: string) => {
        const d = p.replace(/\D/g, "")
        if (d.length === 10) return `+1${d}`
        return p.startsWith("+") ? p : `+${d}`
      },
    }))

    const { handleTelnyxCallControlVoiceWebhook } = await import("@/lib/telnyx-call-control-inbound")
    await expect(
      handleTelnyxCallControlVoiceWebhook({
        data: {
          event_type: "call.initiated",
          id: "evt-init-fail",
          payload: {
            call_control_id: "cc-failsafe-1",
            from: "+15551230000",
            to: "+15025571219",
            direction: "incoming",
          },
        },
      })
    ).resolves.toBeUndefined()

    const answerCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/actions/answer"))
    expect(answerCall).toBeTruthy()
    const answerBody = JSON.parse(String(answerCall![1].body))
    const state = decodeTelnyxCallControlState(answerBody.client_state)
    expect(state?.dialTargetE164).toBe("+15022602716")
  })

  it("call.hangup on inbound leg finalizes call log", async () => {
    const recordCallStatusEvent = vi.fn(() => Promise.resolve())
    const updateCallLog = vi.fn(() => Promise.resolve())
    vi.doMock("@/lib/db", () => ({
      getIncomingRoutingForVoiceWebhook: vi.fn(),
      getRoutingConfigForNumber: vi.fn(),
      insertCallLog: vi.fn(),
      getCallLogSnapshotForTelemetry: vi.fn(() =>
        Promise.resolve({
          id: "log-1",
          user_id: "u1",
          from_number: "+15026558745",
          to_number: "+15025571219",
          duration_seconds: 600,
          call_type: "incoming",
          status: "completed",
          answered_at: "2026-06-27T17:20:00.000Z",
          organization_id: "org-1",
        })
      ),
      recordCallStatusEvent,
      updateCallLog,
      upsertTelnyxCallLegLink: vi.fn(() => Promise.resolve()),
      getTelnyxOutboundLegForInbound: vi.fn(() => Promise.resolve(null)),
      deleteTelnyxCallLegLink: vi.fn(() => Promise.resolve()),
      isReasonablePstnDialString: (s: string) => s.replace(/\D/g, "").length >= 10,
      normalizePhoneNumberE164: (p: string) => p,
    }))
    vi.doMock("@/lib/call-telemetry-realtime", () => ({
      broadcastCallCompleted: vi.fn(() => Promise.resolve()),
    }))
    vi.doMock("@/lib/carrier-credit-alerts", () => ({
      evaluateLowCarrierCreditFromCallUsage: vi.fn(() => Promise.resolve()),
    }))
    vi.doMock("@/lib/post-call-disposition-sms", () => ({
      maybeSendPostCallDispositionSms: vi.fn(() => Promise.resolve()),
    }))
    vi.doMock("@/lib/admin-override-dispatch-sms", () => ({
      maybeSendAdminOverrideDispatchSms: vi.fn(() => Promise.resolve()),
    }))

    const state = encodeTelnyxCallControlState({
      v: 1,
      phase: "await_greeting_end",
      userId: "u1",
      businessLineE164: "+15555571219",
      callerE164: "+15026558745",
      inboundCallControlId: "cc-in-hangup",
      dialTargetE164: "+15552602716",
      fallbackType: "voicemail",
    })

    const { handleTelnyxCallControlVoiceWebhook } = await import("@/lib/telnyx-call-control-inbound")
    await handleTelnyxCallControlVoiceWebhook({
      data: {
        event_type: "call.hangup",
        id: "evt-hangup",
        occurred_at: "2026-06-27T17:30:00.000Z",
        payload: {
          call_control_id: "cc-in-hangup",
          from: "+15026558745",
          to: "+15025571219",
          hangup_cause: "normal_clearing",
          start_time: "2026-06-27T17:20:00.000Z",
          end_time: "2026-06-27T17:30:00.000Z",
          client_state: state,
        },
      },
    })

    expect(recordCallStatusEvent).toHaveBeenCalled()
    expect(updateCallLog).toHaveBeenCalled()
    const statusCall = recordCallStatusEvent.mock.calls[0]
    expect(statusCall[0]).toBe("cc-in-hangup")
    expect(statusCall[1]).toBe("completed")
    expect(statusCall[2]).toBeGreaterThanOrEqual(590)
  })

  it("call.hangup on inbound leg hangs up ringing outbound cell leg", async () => {
    vi.doMock("@/lib/db", () => ({
      getIncomingRoutingForVoiceWebhook: vi.fn(),
      getRoutingConfigForNumber: vi.fn(),
      insertCallLog: vi.fn(),
      getCallLogSnapshotForTelemetry: vi.fn(() => Promise.resolve(null)),
      recordCallStatusEvent: vi.fn(() => Promise.resolve()),
      updateCallLog: vi.fn(() => Promise.resolve()),
      upsertTelnyxCallLegLink: vi.fn(() => Promise.resolve()),
      getTelnyxOutboundLegForInbound: vi.fn(() => Promise.resolve("cc-out-cell")),
      deleteTelnyxCallLegLink: vi.fn(() => Promise.resolve()),
      isReasonablePstnDialString: (s: string) => s.replace(/\D/g, "").length >= 10,
      normalizePhoneNumberE164: (p: string) => p,
    }))
    vi.doMock("@/lib/call-telemetry-realtime", () => ({
      broadcastCallCompleted: vi.fn(() => Promise.resolve()),
    }))
    vi.doMock("@/lib/carrier-credit-alerts", () => ({
      evaluateLowCarrierCreditFromCallUsage: vi.fn(() => Promise.resolve()),
    }))
    vi.doMock("@/lib/post-call-disposition-sms", () => ({
      maybeSendPostCallDispositionSms: vi.fn(() => Promise.resolve()),
    }))
    vi.doMock("@/lib/admin-override-dispatch-sms", () => ({
      maybeSendAdminOverrideDispatchSms: vi.fn(() => Promise.resolve()),
    }))

    const { rememberOutboundDialLeg } = await import("@/lib/telnyx-call-control-leg-map")
    await rememberOutboundDialLeg("cc-in-phantom", "cc-out-cell")

    const state = encodeTelnyxCallControlState({
      v: 1,
      phase: "await_greeting_end",
      userId: "u1",
      businessLineE164: "+15555571219",
      callerE164: "+15026558745",
      // Stale greeting state (no outbound id) — lookup must still find the dialed cell.
      dialTargetE164: "+15552602716",
      fallbackType: "voicemail",
    })

    const { handleTelnyxCallControlVoiceWebhook } = await import("@/lib/telnyx-call-control-inbound")
    await handleTelnyxCallControlVoiceWebhook({
      data: {
        event_type: "call.hangup",
        id: "evt-phantom",
        occurred_at: "2026-06-27T17:30:00.000Z",
        payload: {
          call_control_id: "cc-in-phantom",
          call_session_id: "sess-phantom",
          from: "+15026558745",
          to: "+15025571219",
          hangup_cause: "originator_cancel",
          client_state: state,
        },
      },
    })

    const hangupUrls = fetchMock.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes("/actions/hangup"))
    expect(hangupUrls.some((u) => u.includes("cc-out-cell"))).toBe(true)
  })

  it("call.answered Busy with no teammate starts gather_using_speak", async () => {
    resolveInboundCapturePlanMock.mockResolvedValue({ kind: "presence_on_job" })
    getFirstAvailableOwnerReceptionistMock.mockResolvedValue(null)

    vi.doMock("@/lib/db", () => ({
      getIncomingRoutingForVoiceWebhook: vi.fn(() =>
        Promise.resolve({
          user_id: "u1",
          business_name: "Key Squad 502",
          organization_name: "Key Squad 502",
          phone_line_label: "Main",
          owner_phone: "+15022602716",
          selected_receptionist_id: null,
          receptionist_phone: null,
          receptionist_name: null,
          fallback_type: "voicemail",
          ring_timeout_seconds: 30,
          inbound_caller_greeting_enabled: false,
          account_status: "active",
          primary_phone_number: "+15025571219",
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
    vi.doMock("@/lib/inbound-booking-sms", () => ({
      sendInboundBookingSmsAndTag: vi.fn(() => Promise.resolve()),
    }))

    const answeredState = encodeTelnyxCallControlState({
      v: 1,
      phase: "await_caller_answered",
      userId: "u1",
      businessLineE164: "+15025571219",
      callerE164: "+15025369252",
      dialTargetE164: "+15022602716",
      ringTimeoutSec: 30,
      fallbackType: "voicemail",
    })

    const { handleTelnyxCallControlVoiceWebhook } = await import("@/lib/telnyx-call-control-inbound")
    await handleTelnyxCallControlVoiceWebhook({
      data: {
        event_type: "call.answered",
        id: "evt-busy-gather",
        payload: {
          call_control_id: "cc-busy-gather",
          from: "+15025369252",
          to: "+15025571219",
          direction: "incoming",
          client_state: answeredState,
        },
      },
    })

    const gatherCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/actions/gather_using_speak")
    )
    expect(gatherCall).toBeTruthy()
    const gatherBody = JSON.parse(String(gatherCall![1]?.body || "{}")) as {
      maximum_tries?: number
      voice?: string
    }
    // Telnyx defaults to 3 — we must force 1 so Busy does not replay before music.
    expect(gatherBody.maximum_tries).toBe(1)
    expect(gatherBody.voice).toBeTruthy()
    const hangupCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/actions/hangup"))
    expect(hangupCall).toBeFalsy()
  })

  it("call.gather.ended press 1 sends booking SMS then confirms", async () => {
    const sendSms = vi.fn(() => Promise.resolve())
    vi.doMock("@/lib/db", () => ({
      getIncomingRoutingForVoiceWebhook: vi.fn(() =>
        Promise.resolve({
          user_id: "u1",
          business_name: "Key Squad 502",
          organization_name: "Key Squad 502",
          phone_line_label: "Main",
          owner_phone: "+15022602716",
          selected_receptionist_id: null,
          receptionist_phone: null,
          receptionist_name: null,
          fallback_type: "voicemail",
          ring_timeout_seconds: 30,
          inbound_caller_greeting_enabled: false,
          account_status: "active",
          primary_phone_number: "+15025571219",
          active_phone_count: 1,
        })
      ),
      getRoutingConfigForNumber: vi.fn(),
      insertCallLog: vi.fn(),
      updateCallLog: vi.fn(),
      isReasonablePstnDialString: (s: string) => s.replace(/\D/g, "").length >= 10,
      normalizePhoneNumberE164: (p: string) => {
        const d = p.replace(/\D/g, "")
        if (d.length === 10) return `+1${d}`
        return p.startsWith("+") ? p : `+${d}`
      },
    }))
    vi.doMock("@/lib/inbound-booking-sms", () => ({
      sendInboundBookingSmsAndTag: sendSms,
    }))

    const gatherState = encodeTelnyxCallControlState({
      v: 1,
      phase: "await_busy_gather_end",
      userId: "u1",
      businessLineE164: "+15025571219",
      callerE164: "+15025369252",
      dialReason: "busy_automation",
      fallbackType: "voicemail",
    })

    const { handleTelnyxCallControlVoiceWebhook } = await import("@/lib/telnyx-call-control-inbound")
    await handleTelnyxCallControlVoiceWebhook({
      data: {
        event_type: "call.gather.ended",
        id: "evt-gather-1",
        payload: {
          call_control_id: "cc-gather-1",
          from: "+15025369252",
          to: "+15025571219",
          digits: "1",
          status: "valid",
          client_state: gatherState,
        },
      },
    })

    expect(sendSms).toHaveBeenCalled()
    const speakCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/actions/speak"))
    expect(speakCall).toBeTruthy()
  })

  it("call.gather.ended timeout enters soft hold (music ASAP, no Telnyx enqueue)", async () => {
    vi.doMock("@/lib/db", () => ({
      getIncomingRoutingForVoiceWebhook: vi.fn(() =>
        Promise.resolve({
          user_id: "u1",
          business_name: "Key Squad 502",
          organization_name: "Key Squad 502",
          phone_line_label: "Main",
          owner_phone: "+15022602716",
          selected_receptionist_id: null,
          receptionist_phone: null,
          receptionist_name: null,
          fallback_type: "voicemail",
          ring_timeout_seconds: 30,
          inbound_caller_greeting_enabled: false,
          account_status: "active",
          primary_phone_number: "+15025571219",
          active_phone_count: 1,
        })
      ),
      getRoutingConfigForNumber: vi.fn(),
      insertCallLog: vi.fn(),
      updateCallLog: vi.fn(),
      isReasonablePstnDialString: (s: string) => s.replace(/\D/g, "").length >= 10,
      normalizePhoneNumberE164: (p: string) => {
        const d = p.replace(/\D/g, "")
        if (d.length === 10) return `+1${d}`
        return p.startsWith("+") ? p : `+${d}`
      },
    }))
    vi.doMock("@/lib/inbound-booking-sms", () => ({
      sendInboundBookingSmsAndTag: vi.fn(() => Promise.resolve()),
    }))
    vi.doMock("@/lib/call-queue-db", () => ({
      countWaitingCallQueue: vi.fn(() => Promise.resolve(0)),
      upsertCallQueueWaiting: vi.fn(() => Promise.resolve(null)),
      getAccountHoldMusicUrl: vi.fn(() => Promise.resolve(null)),
      getAccountHoldSettings: vi.fn(() =>
        Promise.resolve({
          holdMusicUrl: null,
          holdMaxWaitSecs: null,
          holdRepromptSecs: null,
        })
      ),
      getCallQueuePosition: vi.fn(() => Promise.resolve(1)),
      updateCallQueueStatus: vi.fn(() => Promise.resolve()),
      listWaitingCallQueue: vi.fn(() => Promise.resolve([])),
    }))
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://lyncr.app")
    vi.stubEnv("LYNCR_HOLD_MUSIC_URL", "https://cdn.example/hold.mp3")

    const gatherState = encodeTelnyxCallControlState({
      v: 1,
      phase: "await_busy_gather_end",
      userId: "u1",
      businessLineE164: "+15025571219",
      callerE164: "+15025369252",
      dialReason: "busy_automation",
      fallbackType: "voicemail",
    })

    const { handleTelnyxCallControlVoiceWebhook } = await import("@/lib/telnyx-call-control-inbound")
    await handleTelnyxCallControlVoiceWebhook({
      data: {
        event_type: "call.gather.ended",
        id: "evt-gather-timeout",
        payload: {
          call_control_id: "cc-gather-to",
          from: "+15025369252",
          to: "+15025571219",
          digits: "",
          status: "timeout",
          client_state: gatherState,
        },
      },
    })

    // Soft-hold: no Telnyx enqueue (Answer uses call_control_id from Neon).
    const enqueueCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/actions/enqueue"))
    expect(enqueueCall).toBeFalsy()
    // Music starts immediately via playback_start (or gather_using_audio fallback).
    const musicAfterEnter = fetchMock.mock.calls.find(
      (c) =>
        String(c[0]).includes("/actions/playback_start") ||
        String(c[0]).includes("/actions/gather_using_audio")
    )
    expect(musicAfterEnter).toBeTruthy()
    const smsHangup = fetchMock.mock.calls.find((c) => String(c[0]).includes("/actions/hangup"))
    expect(smsHangup).toBeFalsy()

    const playbackStart = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/actions/playback_start")
    )
    expect(playbackStart).toBeTruthy()
  })

  it("call.gather.ended hold max-wait sends soft SMS and leaves (no forever hold)", async () => {
    const sendSms = vi.fn(() => Promise.resolve())
    const updateQueue = vi.fn(() => Promise.resolve())
    vi.doMock("@/lib/db", () => ({
      getIncomingRoutingForVoiceWebhook: vi.fn(() =>
        Promise.resolve({
          user_id: "u1",
          business_name: "Key Squad 502",
          organization_name: "Key Squad 502",
          phone_line_label: "Main",
          owner_phone: "+15022602716",
          selected_receptionist_id: null,
          receptionist_phone: null,
          receptionist_name: null,
          fallback_type: "voicemail",
          ring_timeout_seconds: 30,
          inbound_caller_greeting_enabled: false,
          account_status: "active",
          primary_phone_number: "+15025571219",
          active_phone_count: 1,
        })
      ),
      getRoutingConfigForNumber: vi.fn(),
      insertCallLog: vi.fn(),
      updateCallLog: vi.fn(),
      isReasonablePstnDialString: (s: string) => s.replace(/\D/g, "").length >= 10,
      normalizePhoneNumberE164: (p: string) => {
        const d = p.replace(/\D/g, "")
        if (d.length === 10) return `+1${d}`
        return p.startsWith("+") ? p : `+${d}`
      },
    }))
    vi.doMock("@/lib/inbound-booking-sms", () => ({
      sendInboundBookingSmsAndTag: sendSms,
    }))
    vi.doMock("@/lib/call-queue-db", () => ({
      countWaitingCallQueue: vi.fn(() => Promise.resolve(0)),
      upsertCallQueueWaiting: vi.fn(() => Promise.resolve(null)),
      getAccountHoldMusicUrl: vi.fn(() => Promise.resolve(null)),
      getAccountHoldSettings: vi.fn(() =>
        Promise.resolve({
          holdMusicUrl: null,
          holdMaxWaitSecs: 120,
          holdRepromptSecs: null,
        })
      ),
      getCallQueuePosition: vi.fn(() => Promise.resolve(1)),
      updateCallQueueStatus: updateQueue,
      listWaitingCallQueue: vi.fn(() => Promise.resolve([])),
    }))

    // Past max wait (120s) — soft SMS + leave, not infinite music.
    const holdState = encodeTelnyxCallControlState({
      v: 1,
      phase: "await_busy_hold_loop",
      userId: "u1",
      businessLineE164: "+15025571219",
      callerE164: "+15128801744",
      dialReason: "busy_automation",
      holdSegment: "music",
      holdStartedAtMs: Date.now() - 200_000,
      holdMaxWaitSecs: 120,
    })

    const { handleTelnyxCallControlVoiceWebhook } = await import("@/lib/telnyx-call-control-inbound")
    await handleTelnyxCallControlVoiceWebhook({
      data: {
        event_type: "call.gather.ended",
        id: "evt-hold-max-wait",
        payload: {
          call_control_id: "cc-hold-max",
          from: "+15128801744",
          to: "+15025571219",
          digits: "",
          status: "timeout",
          client_state: holdState,
        },
      },
    })

    expect(sendSms).toHaveBeenCalled()
    expect(updateQueue).toHaveBeenCalledWith(
      expect.objectContaining({ callControlId: "cc-hold-max", status: "timed_out" })
    )
    const speakCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/actions/speak"))
    expect(speakCall).toBeTruthy()
  })
})
