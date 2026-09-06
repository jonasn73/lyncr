import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { encodeTelnyxCallControlState, decodeTelnyxCallControlState } from "@/lib/telnyx-call-control-state"
import { parseTelnyxVoiceWebhookEvent } from "@/lib/telnyx-call-control-parse"

const getOrCreateCallControlAppMock = vi.hoisted(() =>
  vi.fn(() => Promise.resolve("cc-app-99"))
)

const getActiveRoutingModeForDidMock = vi.hoisted(() =>
  vi.fn(() => Promise.resolve("your_phone"))
)
// Typed to the real return shapes: a bare `() => Promise.resolve(null)` pins the mock to
// Promise<null>, and `{ kind: "day_dial" as const }` pins it to that one literal — so any
// test wanting another value could not set it.
const getFirstAvailableOwnerReceptionistMock = vi.hoisted(() =>
  vi.fn(
    async (): Promise<{ receptionistId: string; name: string | null; phoneE164: string } | null> =>
      null
  )
)
const getCustomRoutingPhoneForDidMock = vi.hoisted(() =>
  vi.fn(() => Promise.resolve(null))
)
const getTeamReceptionistForDidMock = vi.hoisted(() =>
  vi.fn(() => Promise.resolve(null))
)
const resolveInboundCapturePlanMock = vi.hoisted(() =>
  vi.fn(async (): Promise<{ kind: string }> => ({ kind: "day_dial" }))
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
      // The leg map persists the outbound leg and reads it back. Without these two
      // the persist threw and rememberOutboundDialLeg only ever swallowed it, so the
      // Neon side of the leg map was never exercised by these tests.
      upsertTelnyxCallLegLink: vi.fn(() => Promise.resolve()),
      getTelnyxOutboundLegForInbound: vi.fn(() => Promise.resolve(null)),
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
    // Company voicemail fallback: AMD on, no auto-bridge into personal cell VM.
    expect(dialBody.bridge_on_answer).toBe(false)
    expect(dialBody.answering_machine_detection).toBe("detect")
    // A-leg must get US ringback while the cell rings (Call Control Dial has no ringTone).
    const ringbackCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/actions/playback_start")
    )
    expect(ringbackCall).toBeTruthy()
    const ringbackBody = JSON.parse(String(ringbackCall![1].body))
    expect(ringbackBody.loop).toBe("infinity")
    expect(
      Boolean(ringbackBody.playback_content) || Boolean(ringbackBody.audio_url)
    ).toBe(true)
  })

  it("Hold fallback dial uses AMD with conservative config and full ring timeout", async () => {
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
          fallback_type: "hold",
          ring_timeout_seconds: 30,
          inbound_caller_greeting_enabled: true,
          account_status: "active",
          primary_phone_number: "+15025571219",
          active_phone_count: 1,
        })
      ),
      getRoutingConfigForNumber: vi.fn(),
      insertCallLog: vi.fn(),
      upsertTelnyxCallLegLink: vi.fn(() => Promise.resolve()),
      getTelnyxOutboundLegForInbound: vi.fn(() => Promise.resolve(null)),
      deleteTelnyxCallLegLink: vi.fn(() => Promise.resolve()),
      isReasonablePstnDialString: (s: string) => s.replace(/\D/g, "").length >= 10,
      normalizePhoneNumberE164: (p: string) => p,
    }))

    // ringTimeoutSec already capped by resolveInboundForwardDialTimeoutSeconds at answer time (25s default).
    const inboundState = encodeTelnyxCallControlState({
      v: 1,
      phase: "await_greeting_end",
      userId: "u1",
      businessLineE164: "+15025571219",
      callerE164: "+15551230000",
      dialTargetE164: "+15022602716",
      ringTimeoutSec: 25,
      fallbackType: "hold",
    })

    const { handleTelnyxCallControlVoiceWebhook } = await import("@/lib/telnyx-call-control-inbound")
    await handleTelnyxCallControlVoiceWebhook({
      data: {
        event_type: "call.speak.ended",
        id: "evt-speak-hold-amd",
        payload: {
          call_control_id: "cc-in-hold-amd",
          from: "+15551230000",
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
    expect(dialBody.bridge_on_answer).toBe(false)
    expect(dialBody.answering_machine_detection).toBe("detect")
    expect(dialBody.timeout_secs).toBe(25)
    expect(dialBody.link_to).toBe("cc-in-hold-amd")
    // Conservative AMD knobs — must not use Telnyx's aggressive 3500ms silence default alone,
    // but capped at 5s so a real caller isn't left on injected ringback for 10s+.
    expect(dialBody.answering_machine_detection_config).toMatchObject({
      initial_silence_millis: 5_000,
      total_analysis_time_millis: 5_000,
    })
  })

  it("AMD machine on hold dial hangs up B-leg and starts Busy soft-hold", async () => {
    resolveInboundCapturePlanMock.mockResolvedValue({ kind: "day_dial" })

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
          fallback_type: "hold",
          ring_timeout_seconds: 30,
          inbound_caller_greeting_enabled: true,
          account_status: "active",
          primary_phone_number: "+15025571219",
          active_phone_count: 1,
        })
      ),
      getRoutingConfigForNumber: vi.fn(),
      insertCallLog: vi.fn(),
      getCallLogSnapshotForTelemetry: vi.fn(() => Promise.resolve(null)),
      recordCallStatusEvent: vi.fn(() => Promise.resolve()),
      updateCallLog: vi.fn(() => Promise.resolve()),
      upsertTelnyxCallLegLink: vi.fn(() => Promise.resolve()),
      getTelnyxOutboundLegForInbound: vi.fn(() => Promise.resolve(null)),
      deleteTelnyxCallLegLink: vi.fn(() => Promise.resolve()),
      isReasonablePstnDialString: (s: string) => s.replace(/\D/g, "").length >= 10,
      normalizePhoneNumberE164: (p: string) => p,
    }))
    vi.doMock("@/lib/account-presence", () => ({
      getAccountPresence: vi.fn(() =>
        Promise.resolve({
          presenceStatus: "AVAILABLE",
          onJobGreetingText: "We are with another customer. Press 1 for a text, or stay on the line.",
          closedGreetingText: "",
          ivrBypassCode: "9",
          ivrVoiceEngineModel: "Telnyx.NaturalHD.astra",
          holidayOverrideStart: null,
          holidayOverrideEnd: null,
          holidayGreetingText: null,
        })
      ),
      resolvePresenceAutomationGreeting: vi.fn(() =>
        "We are with another customer. Press 1 for a text, or stay on the line."
      ),
    }))
    vi.doMock("@/lib/call-queue-db", () => ({
      upsertCallQueueBusyMenu: vi.fn(() => Promise.resolve(null)),
      countWaitingCallQueue: vi.fn(() => Promise.resolve(0)),
      upsertCallQueueWaiting: vi.fn(() => Promise.resolve(null)),
      getAccountHoldSettings: vi.fn(() =>
        Promise.resolve({ holdMusicUrl: null, holdMaxWaitSecs: null, holdRepromptSecs: null })
      ),
      getCallQueuePosition: vi.fn(() => Promise.resolve(1)),
      updateCallQueueStatus: vi.fn(() => Promise.resolve()),
      getCallQueueStatusByCallControlId: vi.fn(() => Promise.resolve("holding")),
      listWaitingCallQueue: vi.fn(() => Promise.resolve([])),
    }))

    const dialState = encodeTelnyxCallControlState({
      v: 1,
      phase: "await_dial_end",
      userId: "u1",
      businessLineE164: "+15025571219",
      callerE164: "+15025369252",
      dialTargetE164: "+15022602716",
      inboundCallControlId: "cc-in-amd-m",
      outboundCallControlId: "cc-out-amd-m",
      ringTimeoutSec: 25,
      fallbackType: "hold",
      dialReason: "day_dial",
      amdGuard: true,
      // Dial started 23s ago — past ring−3s (25s → 22s) so machine is trusted.
      dialStartedAtMs: Date.now() - 23_000,
    })

    const { handleTelnyxCallControlVoiceWebhook } = await import("@/lib/telnyx-call-control-inbound")
    await handleTelnyxCallControlVoiceWebhook({
      data: {
        event_type: "call.machine.detection.ended",
        id: "evt-amd-machine",
        payload: {
          call_control_id: "cc-out-amd-m",
          from: "+15025571219",
          to: "+15022602716",
          direction: "outgoing",
          result: "machine",
          client_state: dialState,
        },
      },
    })

    // B-leg (cell / carrier VM) must be hung up.
    const outboundHangup = fetchMock.mock.calls.find(
      (c) =>
        String(c[0]).includes("cc-out-amd-m") && String(c[0]).includes("/actions/hangup")
    )
    expect(outboundHangup).toBeTruthy()
    // Soft-hold entry = Busy gather on the inbound caller.
    const gatherCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/actions/gather_using_speak")
    )
    expect(gatherCall).toBeTruthy()
    expect(String(gatherCall![0])).toContain("cc-in-amd-m")
    // Must not hang up the waiting caller.
    const inboundHangup = fetchMock.mock.calls.find(
      (c) =>
        String(c[0]).includes("cc-in-amd-m") && String(c[0]).includes("/actions/hangup")
    )
    expect(inboundHangup).toBeFalsy()
  })

  it("early AMD machine (false positive) bridges as human instead of killing the ring", async () => {
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
          fallback_type: "hold",
          ring_timeout_seconds: 25,
          inbound_caller_greeting_enabled: true,
          account_status: "active",
          primary_phone_number: "+15025571219",
          active_phone_count: 1,
        })
      ),
      updateCallLog: vi.fn(() => Promise.resolve()),
      getCallLogSnapshotForTelemetry: vi.fn(() => Promise.resolve(null)),
      recordCallStatusEvent: vi.fn(() => Promise.resolve()),
      isReasonablePstnDialString: (s: string) => s.replace(/\D/g, "").length >= 10,
      normalizePhoneNumberE164: (p: string) => p,
    }))

    const dialState = encodeTelnyxCallControlState({
      v: 1,
      phase: "await_dial_end",
      userId: "u1",
      businessLineE164: "+15025571219",
      callerE164: "+15025369252",
      dialTargetE164: "+15022602716",
      inboundCallControlId: "cc-in-amd-early",
      outboundCallControlId: "cc-out-amd-early",
      ringTimeoutSec: 25,
      fallbackType: "hold",
      dialReason: "day_dial",
      amdGuard: true,
      // Only 3s since Dial — classic false-positive window.
      dialStartedAtMs: Date.now() - 3_000,
    })

    const { handleTelnyxCallControlVoiceWebhook } = await import("@/lib/telnyx-call-control-inbound")
    await handleTelnyxCallControlVoiceWebhook({
      data: {
        event_type: "call.machine.detection.ended",
        id: "evt-amd-early-machine",
        payload: {
          call_control_id: "cc-out-amd-early",
          from: "+15025571219",
          to: "+15022602716",
          direction: "outgoing",
          result: "machine",
          client_state: dialState,
        },
      },
    })

    // Must NOT hang up the cell leg on an early false machine.
    const outboundHangup = fetchMock.mock.calls.find(
      (c) =>
        String(c[0]).includes("cc-out-amd-early") && String(c[0]).includes("/actions/hangup")
    )
    expect(outboundHangup).toBeFalsy()
    // Bridge as human so a quick pickup is not dropped into hold.
    const bridgeCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/actions/bridge"))
    expect(bridgeCall).toBeTruthy()
    const gatherCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/actions/gather_using_speak")
    )
    expect(gatherCall).toBeFalsy()
  })

  it("AMD silence is not treated as machine (bridges)", async () => {
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
          fallback_type: "hold",
          ring_timeout_seconds: 25,
          inbound_caller_greeting_enabled: true,
          account_status: "active",
          primary_phone_number: "+15025571219",
          active_phone_count: 1,
        })
      ),
      updateCallLog: vi.fn(() => Promise.resolve()),
      getCallLogSnapshotForTelemetry: vi.fn(() => Promise.resolve(null)),
      recordCallStatusEvent: vi.fn(() => Promise.resolve()),
      isReasonablePstnDialString: (s: string) => s.replace(/\D/g, "").length >= 10,
      normalizePhoneNumberE164: (p: string) => p,
    }))

    const dialState = encodeTelnyxCallControlState({
      v: 1,
      phase: "await_dial_end",
      userId: "u1",
      businessLineE164: "+15025571219",
      callerE164: "+15025369252",
      dialTargetE164: "+15022602716",
      inboundCallControlId: "cc-in-amd-sil",
      outboundCallControlId: "cc-out-amd-sil",
      ringTimeoutSec: 25,
      fallbackType: "hold",
      dialReason: "day_dial",
      amdGuard: true,
      dialStartedAtMs: Date.now() - 20_000,
    })

    const { handleTelnyxCallControlVoiceWebhook } = await import("@/lib/telnyx-call-control-inbound")
    await handleTelnyxCallControlVoiceWebhook({
      data: {
        event_type: "call.machine.premium.detection.ended",
        id: "evt-amd-silence",
        payload: {
          call_control_id: "cc-out-amd-sil",
          from: "+15025571219",
          to: "+15022602716",
          direction: "outgoing",
          result: "silence",
          client_state: dialState,
        },
      },
    })

    const outboundHangup = fetchMock.mock.calls.find(
      (c) =>
        String(c[0]).includes("cc-out-amd-sil") && String(c[0]).includes("/actions/hangup")
    )
    expect(outboundHangup).toBeFalsy()
    expect(fetchMock.mock.calls.find((c) => String(c[0]).includes("/actions/bridge"))).toBeTruthy()
  })

  it("AMD human on hold dial bridges A and B legs", async () => {
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
          fallback_type: "hold",
          ring_timeout_seconds: 18,
          inbound_caller_greeting_enabled: true,
          account_status: "active",
          primary_phone_number: "+15025571219",
          active_phone_count: 1,
        })
      ),
      updateCallLog: vi.fn(() => Promise.resolve()),
      getCallLogSnapshotForTelemetry: vi.fn(() => Promise.resolve(null)),
      recordCallStatusEvent: vi.fn(() => Promise.resolve()),
      isReasonablePstnDialString: (s: string) => s.replace(/\D/g, "").length >= 10,
      normalizePhoneNumberE164: (p: string) => p,
    }))

    const dialState = encodeTelnyxCallControlState({
      v: 1,
      phase: "await_dial_end",
      userId: "u1",
      businessLineE164: "+15025571219",
      callerE164: "+15025369252",
      dialTargetE164: "+15022602716",
      inboundCallControlId: "cc-in-amd-h",
      outboundCallControlId: "cc-out-amd-h",
      ringTimeoutSec: 18,
      fallbackType: "hold",
      dialReason: "day_dial",
      amdGuard: true,
    })

    const { handleTelnyxCallControlVoiceWebhook } = await import("@/lib/telnyx-call-control-inbound")
    await handleTelnyxCallControlVoiceWebhook({
      data: {
        event_type: "call.machine.detection.ended",
        id: "evt-amd-human",
        payload: {
          call_control_id: "cc-out-amd-h",
          from: "+15025571219",
          to: "+15022602716",
          direction: "outgoing",
          result: "human",
          client_state: dialState,
        },
      },
    })

    const bridgeCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/actions/bridge"))
    expect(bridgeCall).toBeTruthy()
    const bridgeBody = JSON.parse(String(bridgeCall![1].body))
    expect(bridgeBody.call_control_id).toBe("cc-in-amd-h")
    // No soft-hold gather when a human answered.
    const gatherCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/actions/gather_using_speak")
    )
    expect(gatherCall).toBeFalsy()
  })

  it("a human pickup whose bridge fails twice falls back to hold instead of abandoning the call", async () => {
    // Regression: a real answered call (receptionist picked up) whose Bridge API call
    // failed on both the first attempt and the early-window retry used to just `return`
    // here, leaving both legs connected-but-unbridged forever — the caller heard only
    // injected ringback and the cell leg sat open with no cleanup until someone gave up.
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
          receptionist_name: "Alex Jonas",
          fallback_type: "hold",
          ring_timeout_seconds: 30,
          inbound_caller_greeting_enabled: true,
          account_status: "active",
          primary_phone_number: "+15025571219",
          active_phone_count: 1,
        })
      ),
      updateCallLog: vi.fn(() => Promise.resolve()),
      getCallLogSnapshotForTelemetry: vi.fn(() => Promise.resolve(null)),
      recordCallStatusEvent: vi.fn(() => Promise.resolve()),
      deleteTelnyxCallLegLink: vi.fn(() => Promise.resolve()),
      isReasonablePstnDialString: (s: string) => s.replace(/\D/g, "").length >= 10,
      normalizePhoneNumberE164: (p: string) => p,
    }))

    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/actions/bridge")) {
        return { ok: false, status: 422, json: async () => ({ errors: [{ detail: "call not active" }] }) }
      }
      return { ok: true, json: async () => ({ data: { call_control_id: "cc-outbound-1" } }) }
    })

    const dialState = encodeTelnyxCallControlState({
      v: 1,
      phase: "await_dial_end",
      userId: "u1",
      businessLineE164: "+15025571219",
      callerE164: "+15025369252",
      dialTargetE164: "+15029995874",
      inboundCallControlId: "cc-in-amd-failbridge",
      outboundCallControlId: "cc-out-amd-failbridge",
      ringTimeoutSec: 30,
      fallbackType: "hold",
      dialReason: "day_dial",
      receptionistId: "77803d63-b9e9-4739-9129-30a9ad641864",
      amdGuard: true,
      // Quick real pickup — well inside the early-window retry path.
      dialStartedAtMs: Date.now() - 4_000,
    })

    const { handleTelnyxCallControlVoiceWebhook } = await import("@/lib/telnyx-call-control-inbound")
    await handleTelnyxCallControlVoiceWebhook({
      data: {
        event_type: "call.machine.detection.ended",
        id: "evt-amd-human-bridge-fail",
        payload: {
          call_control_id: "cc-out-amd-failbridge",
          from: "+15025571219",
          to: "+15029995874",
          direction: "outgoing",
          result: "human",
          client_state: dialState,
        },
      },
    })

    // Both bridge attempts were made (and both failed per the mock above).
    const bridgeCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/actions/bridge"))
    expect(bridgeCalls.length).toBe(2)
    // The cell leg must be hung up rather than left connected-but-silent forever.
    const outboundHangup = fetchMock.mock.calls.find(
      (c) =>
        String(c[0]).includes("cc-out-amd-failbridge") && String(c[0]).includes("/actions/hangup")
    )
    expect(outboundHangup).toBeTruthy()
    // And the caller must be rerouted into the hold flow, not left listening to dead ringback.
    const gatherCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/actions/gather_using_speak")
    )
    expect(gatherCall).toBeTruthy()
    expect(String(gatherCall![0])).toContain("cc-in-amd-failbridge")
  })

  it("receptionist's console HUD opens the instant her cell answers, before AMD/bridge resolve", async () => {
    // Regression: on an AMD-guarded dial (fallback_type hold/ai/voicemail), the intake HUD
    // used to only fire once the bridge succeeded — which waits on the full AMD analysis
    // window. Her console should not have to wait that long to know a call is coming in.
    const handleCallConnectedMock = vi.fn(() => Promise.resolve({ broadcast: true }))
    vi.doMock("@/app/actions/call-events", () => ({
      handleCallConnected: handleCallConnectedMock,
    }))
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
          receptionist_name: "Alex Jonas",
          fallback_type: "hold",
          ring_timeout_seconds: 30,
          inbound_caller_greeting_enabled: true,
          account_status: "active",
          primary_phone_number: "+15025571219",
          active_phone_count: 1,
        })
      ),
      getActivePhoneNumberByE164: vi.fn(() => Promise.resolve(null)),
      getUser: vi.fn(() => Promise.resolve({ industry: "locksmith" })),
      isReasonablePstnDialString: (s: string) => s.replace(/\D/g, "").length >= 10,
      normalizePhoneNumberE164: (p: string) => p,
    }))

    const dialState = encodeTelnyxCallControlState({
      v: 1,
      phase: "await_dial_end",
      userId: "u1",
      businessLineE164: "+15025571219",
      callerE164: "+15025369252",
      dialTargetE164: "+15029995874",
      inboundCallControlId: "cc-in-pickup",
      outboundCallControlId: "cc-out-pickup",
      ringTimeoutSec: 30,
      fallbackType: "hold",
      dialReason: "day_dial",
      receptionistId: "77803d63-b9e9-4739-9129-30a9ad641864",
      amdGuard: true,
    })

    const { handleTelnyxCallControlVoiceWebhook } = await import("@/lib/telnyx-call-control-inbound")
    await handleTelnyxCallControlVoiceWebhook({
      data: {
        event_type: "call.answered",
        id: "evt-cell-pickup",
        payload: {
          call_control_id: "cc-out-pickup",
          from: "+15025571219",
          to: "+15029995874",
          direction: "outgoing",
          client_state: dialState,
        },
      },
    })

    expect(handleCallConnectedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        receptionistId: "77803d63-b9e9-4739-9129-30a9ad641864",
        callLogId: "cc-in-pickup",
        businessType: "locksmith",
        callerNumber: "+15025369252",
      })
    )
    // No bridge/gather yet — that still waits on AMD, only the HUD jumps ahead.
    expect(fetchMock.mock.calls.find((c) => String(c[0]).includes("/actions/bridge"))).toBeFalsy()
  })

  it("owner fallback dial still auto-bridges (no AMD)", async () => {
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
          fallback_type: "owner",
          ring_timeout_seconds: 30,
          inbound_caller_greeting_enabled: true,
          account_status: "active",
          primary_phone_number: "+15555571219",
          active_phone_count: 1,
        })
      ),
      getRoutingConfigForNumber: vi.fn(),
      insertCallLog: vi.fn(),
      upsertTelnyxCallLegLink: vi.fn(() => Promise.resolve()),
      getTelnyxOutboundLegForInbound: vi.fn(() => Promise.resolve(null)),
      deleteTelnyxCallLegLink: vi.fn(() => Promise.resolve()),
      isReasonablePstnDialString: (s: string) => s.replace(/\D/g, "").length >= 10,
      normalizePhoneNumberE164: (p: string) => p,
    }))

    const inboundState = encodeTelnyxCallControlState({
      v: 1,
      phase: "await_greeting_end",
      userId: "u1",
      businessLineE164: "+15555571219",
      callerE164: "+15551230000",
      dialTargetE164: "+15552602716",
      ringTimeoutSec: 30,
      fallbackType: "owner",
    })

    const { handleTelnyxCallControlVoiceWebhook } = await import("@/lib/telnyx-call-control-inbound")
    await handleTelnyxCallControlVoiceWebhook({
      data: {
        event_type: "call.speak.ended",
        id: "evt-speak-owner-fb",
        payload: {
          call_control_id: "cc-inbound-owner-fb",
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
    expect(dialBody.bridge_on_answer).toBe(true)
    expect(dialBody.answering_machine_detection).toBeUndefined()
  })

  it("parseTelnyxVoiceWebhookEvent reads AMD result", () => {
    const evt = parseTelnyxVoiceWebhookEvent({
      data: {
        event_type: "call.machine.detection.ended",
        id: "evt-parse-amd",
        payload: {
          call_control_id: "cc-x",
          result: "machine",
        },
      },
    })
    expect(evt?.amdResult).toBe("machine")
    expect(evt?.eventType).toBe("call.machine.detection.ended")
  })

  it("speak.failed after Available greet dials cell (no silent hang)", async () => {
    // Production: ElevenLabs Speak HTTP 200 then call.speak.failed — speak.ended never
    // arrived and the owner cell never rang. Recover by Dialing immediately.
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
      getTelnyxOutboundLegForInbound: vi.fn(() => Promise.resolve(null)),
      upsertTelnyxCallLegLink: vi.fn(() => Promise.resolve()),
      deleteTelnyxCallLegLink: vi.fn(() => Promise.resolve()),
    }))

    const inboundState = encodeTelnyxCallControlState({
      v: 1,
      phase: "await_greeting_end",
      userId: "u1",
      businessLineE164: "+15025571219",
      callerE164: "+15551230000",
      dialTargetE164: "+15022602716",
      ringTimeoutSec: 30,
      fallbackType: "voicemail",
      dialReason: "day_dial",
      holdSpeakVoice: "ElevenLabs.eleven_multilingual_v2.21m00Tcm4TlvDq8ikWAM",
    })

    const { handleTelnyxCallControlVoiceWebhook } = await import("@/lib/telnyx-call-control-inbound")
    await handleTelnyxCallControlVoiceWebhook({
      data: {
        event_type: "call.speak.failed",
        id: "evt-speak-fail",
        payload: {
          call_control_id: "cc-inbound-greet-fail-1",
          from: "+15551230000",
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
    expect(dialBody.to).toBe("+15022602716")
    expect(dialBody.link_to).toBe("cc-inbound-greet-fail-1")
    // Even when greet Speak fails, caller must hear US ringback while cell rings.
    const ringbackCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/actions/playback_start")
    )
    expect(ringbackCall).toBeTruthy()
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
      // The leg map persists the outbound leg and reads it back. Without these two
      // the persist threw and rememberOutboundDialLeg only ever swallowed it, so the
      // Neon side of the leg map was never exercised by these tests.
      upsertTelnyxCallLegLink: vi.fn(() => Promise.resolve()),
      getTelnyxOutboundLegForInbound: vi.fn(() => Promise.resolve(null)),
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
      // The leg map persists the outbound leg and reads it back. Without these two
      // the persist threw and rememberOutboundDialLeg only ever swallowed it, so the
      // Neon side of the leg map was never exercised by these tests.
      upsertTelnyxCallLegLink: vi.fn(() => Promise.resolve()),
      getTelnyxOutboundLegForInbound: vi.fn(() => Promise.resolve(null)),
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
    const speakBody = JSON.parse(String(speakCall![1].body))
    // Available connect greet uses NaturalHD (not flaky ElevenLabs) so callers hear audio.
    expect(String(speakBody.voice || "")).toMatch(/^Telnyx\.NaturalHD\./i)
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
    // The bare vi.fn() has no signature, so mock.calls is typed as an empty tuple.
    const [statusSid, statusValue, statusSeconds] = recordCallStatusEvent.mock
      .calls[0] as unknown as [string, string, number]
    expect(statusSid).toBe("cc-in-hangup")
    expect(statusValue).toBe("completed")
    expect(statusSeconds).toBeGreaterThanOrEqual(590)
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
      sendInboundBookingSmsAndTag: vi.fn(() => Promise.resolve({ outcome: "sent" })),
      bookingSmsConfirmSpeech: vi.fn(() => "mock booking sms confirm speech"),
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
    const sendSms = vi.fn(() => Promise.resolve({ outcome: "sent" }))
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
      bookingSmsConfirmSpeech: vi.fn(() => "mock booking sms confirm speech"),
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
      sendInboundBookingSmsAndTag: vi.fn(() => Promise.resolve({ outcome: "sent" })),
      bookingSmsConfirmSpeech: vi.fn(() => "mock booking sms confirm speech"),
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
      getCallQueueStatusByCallControlId: vi.fn(() => Promise.resolve("holding")),
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

  it("call.gather.ended timeout during CLOSED hours still enters real hold (no auto-text-and-hangup)", async () => {
    // Regression: closed/holiday timeouts used to skip straight to booking SMS + hangup even
    // though the greeting promises "please hold, next available assistant will be right with
    // you." Staying on the line during closed hours must now behave the same as open hours.
    vi.doMock("@/lib/account-presence", () => ({
      getAccountPresence: vi.fn(() =>
        Promise.resolve({
          presenceStatus: "CLOSED",
          presenceClosedManual: false,
          onJobGreetingText: "We're on a job. Press 1 to get a booking link by text, or stay on the line.",
          closedGreetingText:
            "Please hold, and the next available assistant will be right with you.",
          ivrBypassCode: null,
        })
      ),
      resolvePresenceAutomationGreeting: vi.fn(
        () => "Please hold, and the next available assistant will be right with you."
      ),
    }))
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
    const sendSms = vi.fn(() => Promise.resolve({ outcome: "sent" }))
    vi.doMock("@/lib/inbound-booking-sms", () => ({
      sendInboundBookingSmsAndTag: sendSms,
      bookingSmsConfirmSpeech: vi.fn(() => "mock booking sms confirm speech"),
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
      getCallQueueStatusByCallControlId: vi.fn(() => Promise.resolve("holding")),
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
        id: "evt-gather-timeout-closed",
        payload: {
          call_control_id: "cc-gather-to-closed",
          from: "+15025369252",
          to: "+15025571219",
          digits: "",
          status: "timeout",
          client_state: gatherState,
        },
      },
    })

    // No immediate booking SMS + hangup — the caller must land in the real hold loop.
    expect(sendSms).not.toHaveBeenCalled()
    const hangupCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/actions/hangup"))
    expect(hangupCall).toBeFalsy()
    const musicStarted = fetchMock.mock.calls.find(
      (c) =>
        String(c[0]).includes("/actions/playback_start") ||
        String(c[0]).includes("/actions/gather_using_audio")
    )
    expect(musicStarted).toBeTruthy()
  })

  it("call.gather.ended hold max-wait sends soft SMS and leaves (no forever hold)", async () => {
    const sendSms = vi.fn(() => Promise.resolve({ outcome: "sent" }))
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
      bookingSmsConfirmSpeech: vi.fn(() => "mock booking sms confirm speech"),
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
      getCallQueueStatusByCallControlId: vi.fn(() => Promise.resolve("holding")),
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

  it("Available dial no-answer with hold fallback starts Busy gather (soft hold path)", async () => {
    resolveInboundCapturePlanMock.mockResolvedValue({ kind: "day_dial" })

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
          fallback_type: "hold",
          ring_timeout_seconds: 30,
          inbound_caller_greeting_enabled: true,
          account_status: "active",
          primary_phone_number: "+15025571219",
          active_phone_count: 1,
        })
      ),
      getRoutingConfigForNumber: vi.fn(),
      insertCallLog: vi.fn(),
      getCallLogSnapshotForTelemetry: vi.fn(() => Promise.resolve(null)),
      recordCallStatusEvent: vi.fn(() => Promise.resolve()),
      updateCallLog: vi.fn(() => Promise.resolve()),
      upsertTelnyxCallLegLink: vi.fn(() => Promise.resolve()),
      getTelnyxOutboundLegForInbound: vi.fn(() => Promise.resolve(null)),
      deleteTelnyxCallLegLink: vi.fn(() => Promise.resolve()),
      isReasonablePstnDialString: (s: string) => s.replace(/\D/g, "").length >= 10,
      normalizePhoneNumberE164: (p: string) => p,
    }))
    vi.doMock("@/lib/account-presence", () => ({
      getAccountPresence: vi.fn(() =>
        Promise.resolve({
          presenceStatus: "AVAILABLE",
          onJobGreetingText: "We are with another customer. Press 1 for a text, or stay on the line.",
          closedGreetingText: "",
          ivrBypassCode: "9",
          ivrVoiceEngineModel: "Telnyx.NaturalHD.astra",
          holidayOverrideStart: null,
          holidayOverrideEnd: null,
          holidayGreetingText: null,
        })
      ),
      // Without this the busy greeting lookup threw, startBusyAutomationFlow
      // swallowed it, and this test passed over a path it never exercised.
      resolvePresenceAutomationGreeting: vi.fn(() =>
        "We are with another customer. Press 1 for a text, or stay on the line."
      ),
    }))
    vi.doMock("@/lib/call-queue-db", () => ({
      upsertCallQueueBusyMenu: vi.fn(() => Promise.resolve(null)),
      countWaitingCallQueue: vi.fn(() => Promise.resolve(0)),
      upsertCallQueueWaiting: vi.fn(() => Promise.resolve(null)),
      getAccountHoldSettings: vi.fn(() =>
        Promise.resolve({ holdMusicUrl: null, holdMaxWaitSecs: null, holdRepromptSecs: null })
      ),
      getCallQueuePosition: vi.fn(() => Promise.resolve(1)),
      updateCallQueueStatus: vi.fn(() => Promise.resolve()),
      getCallQueueStatusByCallControlId: vi.fn(() => Promise.resolve("holding")),
      listWaitingCallQueue: vi.fn(() => Promise.resolve([])),
    }))

    // Outbound cell leg timed out while inbound was waiting (await_dial_end).
    const dialState = encodeTelnyxCallControlState({
      v: 1,
      phase: "await_dial_end",
      userId: "u1",
      businessLineE164: "+15025571219",
      callerE164: "+15025369252",
      dialTargetE164: "+15022602716",
      inboundCallControlId: "cc-in-hold-fb",
      outboundCallControlId: "cc-out-hold-fb",
      ringTimeoutSec: 30,
      fallbackType: "hold",
      dialReason: "day_dial",
    })

    const { handleTelnyxCallControlVoiceWebhook } = await import("@/lib/telnyx-call-control-inbound")
    await handleTelnyxCallControlVoiceWebhook({
      data: {
        event_type: "call.hangup",
        id: "evt-dial-na-hold",
        payload: {
          call_control_id: "cc-out-hold-fb",
          from: "+15025571219",
          to: "+15022602716",
          direction: "outgoing",
          hangup_cause: "timeout",
          dial: { status: "no_answer" },
          client_state: dialState,
        },
      },
    })

    // Same entry as Busy: gather_using_speak → stay on line → soft hold music.
    const gatherCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/actions/gather_using_speak")
    )
    expect(gatherCall).toBeTruthy()
    // Must not dump straight to voicemail Speak or Hangup the inbound.
    const inboundHangup = fetchMock.mock.calls.find(
      (c) =>
        String(c[0]).includes("cc-in-hold-fb") && String(c[0]).includes("/actions/hangup")
    )
    expect(inboundHangup).toBeFalsy()
  })

  it("Busy greeting acknowledges a caller who already tried and got missed today", async () => {
    resolveInboundCapturePlanMock.mockResolvedValue({ kind: "day_dial" })

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
          fallback_type: "hold",
          ring_timeout_seconds: 30,
          inbound_caller_greeting_enabled: true,
          account_status: "active",
          primary_phone_number: "+15025571219",
          active_phone_count: 1,
        })
      ),
      getRoutingConfigForNumber: vi.fn(),
      insertCallLog: vi.fn(),
      getCallLogSnapshotForTelemetry: vi.fn(() => Promise.resolve(null)),
      recordCallStatusEvent: vi.fn(() => Promise.resolve()),
      updateCallLog: vi.fn(() => Promise.resolve()),
      upsertTelnyxCallLegLink: vi.fn(() => Promise.resolve()),
      getTelnyxOutboundLegForInbound: vi.fn(() => Promise.resolve(null)),
      deleteTelnyxCallLegLink: vi.fn(() => Promise.resolve()),
      isReasonablePstnDialString: (s: string) => s.replace(/\D/g, "").length >= 10,
      normalizePhoneNumberE164: (p: string) => p,
      // Same caller was missed 5 minutes ago — resolveRepeatCallerUrgency should flag this
      // as a repeat attempt and the Busy greeting should acknowledge it.
      listTodaysCallLogsForCaller: vi.fn(() =>
        Promise.resolve([
          {
            id: "prior-missed-1",
            from_number: "+15025369252",
            created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
            call_type: "missed",
            status: "no-answer",
            answered_at: null,
            ended_at: new Date(Date.now() - 5 * 60_000).toISOString(),
          },
        ])
      ),
    }))
    vi.doMock("@/lib/account-presence", () => ({
      getAccountPresence: vi.fn(() =>
        Promise.resolve({
          presenceStatus: "AVAILABLE",
          onJobGreetingText: "We are with another customer. Press 1 for a text, or stay on the line.",
          closedGreetingText: "",
          ivrBypassCode: "9",
          ivrVoiceEngineModel: "Telnyx.NaturalHD.astra",
          holidayOverrideStart: null,
          holidayOverrideEnd: null,
          holidayGreetingText: null,
        })
      ),
      resolvePresenceAutomationGreeting: vi.fn(() =>
        "We are with another customer. Press 1 for a text, or stay on the line."
      ),
    }))
    vi.doMock("@/lib/call-queue-db", () => ({
      upsertCallQueueBusyMenu: vi.fn(() => Promise.resolve(null)),
      countWaitingCallQueue: vi.fn(() => Promise.resolve(0)),
      upsertCallQueueWaiting: vi.fn(() => Promise.resolve(null)),
      getAccountHoldSettings: vi.fn(() =>
        Promise.resolve({ holdMusicUrl: null, holdMaxWaitSecs: null, holdRepromptSecs: null })
      ),
      getCallQueuePosition: vi.fn(() => Promise.resolve(1)),
      updateCallQueueStatus: vi.fn(() => Promise.resolve()),
      getCallQueueStatusByCallControlId: vi.fn(() => Promise.resolve("holding")),
      listWaitingCallQueue: vi.fn(() => Promise.resolve([])),
    }))

    const dialState = encodeTelnyxCallControlState({
      v: 1,
      phase: "await_dial_end",
      userId: "u1",
      businessLineE164: "+15025571219",
      callerE164: "+15025369252",
      dialTargetE164: "+15022602716",
      inboundCallControlId: "cc-in-repeat",
      outboundCallControlId: "cc-out-repeat",
      ringTimeoutSec: 30,
      fallbackType: "hold",
      dialReason: "day_dial",
    })

    const { handleTelnyxCallControlVoiceWebhook } = await import("@/lib/telnyx-call-control-inbound")
    await handleTelnyxCallControlVoiceWebhook({
      data: {
        event_type: "call.hangup",
        id: "evt-dial-na-repeat",
        payload: {
          call_control_id: "cc-out-repeat",
          from: "+15025571219",
          to: "+15022602716",
          direction: "outgoing",
          hangup_cause: "timeout",
          dial: { status: "no_answer" },
          client_state: dialState,
        },
      },
    })

    const gatherCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/actions/gather_using_speak")
    )
    expect(gatherCall).toBeTruthy()
    const gatherBody = JSON.parse(String(gatherCall![1]?.body || "{}")) as { payload?: string }
    expect(gatherBody.payload).toContain("Thanks for trying us again")
  })

  it("Busy greeting never names a known customer, even when their name is on file (087)", async () => {
    resolveInboundCapturePlanMock.mockResolvedValue({ kind: "day_dial" })

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
          fallback_type: "hold",
          ring_timeout_seconds: 30,
          inbound_caller_greeting_enabled: true,
          account_status: "active",
          primary_phone_number: "+15025571219",
          active_phone_count: 1,
        })
      ),
      getRoutingConfigForNumber: vi.fn(),
      insertCallLog: vi.fn(),
      getCallLogSnapshotForTelemetry: vi.fn(() => Promise.resolve(null)),
      recordCallStatusEvent: vi.fn(() => Promise.resolve()),
      updateCallLog: vi.fn(() => Promise.resolve()),
      upsertTelnyxCallLegLink: vi.fn(() => Promise.resolve()),
      getTelnyxOutboundLegForInbound: vi.fn(() => Promise.resolve(null)),
      deleteTelnyxCallLegLink: vi.fn(() => Promise.resolve()),
      isReasonablePstnDialString: (s: string) => s.replace(/\D/g, "").length >= 10,
      normalizePhoneNumberE164: (p: string) => p,
      listTodaysCallLogsForCaller: vi.fn(() => Promise.resolve([])),
      getCustomerByPhoneForUser: vi.fn(() =>
        Promise.resolve({ display_name: "Briann", phone_e164: "+15025369252" })
      ),
    }))
    vi.doMock("@/lib/account-presence", () => ({
      getAccountPresence: vi.fn(() =>
        Promise.resolve({
          presenceStatus: "AVAILABLE",
          onJobGreetingText: "We are with another customer. Press 1 for a text, or stay on the line.",
          closedGreetingText: "",
          ivrBypassCode: "9",
          ivrVoiceEngineModel: "Telnyx.NaturalHD.astra",
          holidayOverrideStart: null,
          holidayOverrideEnd: null,
          holidayGreetingText: null,
        })
      ),
      resolvePresenceAutomationGreeting: vi.fn(() =>
        "We are with another customer. Press 1 for a text, or stay on the line."
      ),
    }))
    vi.doMock("@/lib/call-queue-db", () => ({
      upsertCallQueueBusyMenu: vi.fn(() => Promise.resolve(null)),
      countWaitingCallQueue: vi.fn(() => Promise.resolve(0)),
      upsertCallQueueWaiting: vi.fn(() => Promise.resolve(null)),
      getAccountHoldSettings: vi.fn(() =>
        Promise.resolve({ holdMusicUrl: null, holdMaxWaitSecs: null, holdRepromptSecs: null })
      ),
      getCallQueuePosition: vi.fn(() => Promise.resolve(1)),
      updateCallQueueStatus: vi.fn(() => Promise.resolve()),
      getCallQueueStatusByCallControlId: vi.fn(() => Promise.resolve("holding")),
      listWaitingCallQueue: vi.fn(() => Promise.resolve([])),
    }))

    const dialState = encodeTelnyxCallControlState({
      v: 1,
      phase: "await_dial_end",
      userId: "u1",
      businessLineE164: "+15025571219",
      callerE164: "+15025369252",
      dialTargetE164: "+15022602716",
      inboundCallControlId: "cc-in-named",
      outboundCallControlId: "cc-out-named",
      ringTimeoutSec: 30,
      fallbackType: "hold",
      dialReason: "day_dial",
    })

    const { handleTelnyxCallControlVoiceWebhook } = await import("@/lib/telnyx-call-control-inbound")
    await handleTelnyxCallControlVoiceWebhook({
      data: {
        event_type: "call.hangup",
        id: "evt-dial-na-named",
        payload: {
          call_control_id: "cc-out-named",
          from: "+15025571219",
          to: "+15022602716",
          direction: "outgoing",
          hangup_cause: "timeout",
          dial: { status: "no_answer" },
          client_state: dialState,
        },
      },
    })

    const gatherCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/actions/gather_using_speak")
    )
    expect(gatherCall).toBeTruthy()
    const gatherBody = JSON.parse(String(gatherCall![1]?.body || "{}")) as { payload?: string }
    expect(gatherBody.payload).not.toContain("Briann")
    expect(gatherBody.payload).not.toContain("Hey ")
    expect(gatherBody.payload).not.toContain("trying us again")
    expect(gatherBody.payload).toContain("We are with another customer.")
  })

  it("call.speak.ended on an ElevenLabs voice closes the circuit immediately (best-quality self-heal)", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key")

    vi.doMock("@/lib/db", () => ({
      updateCallLog: vi.fn(() => Promise.resolve()),
      isReasonablePstnDialString: (s: string) => s.replace(/\D/g, "").length >= 10,
      normalizePhoneNumberE164: (p: string) => p,
    }))

    // Dynamic imports so this resolves to the exact same module graph the code under
    // test uses in this file's vi.resetModules()-per-test setup (a static top-of-file
    // import would bind to a stale pre-reset instance and never see the update).
    const {
      elevenLabsCallControlVoice,
      ELEVENLABS_VOICE_IDS,
      elevenLabsSpeakRuntimeAllowed,
      markElevenLabsSpeakFailed,
      resetElevenLabsSpeakCircuitForTests,
    } = await import("@/lib/elevenlabs-voices")
    resetElevenLabsSpeakCircuitForTests()
    markElevenLabsSpeakFailed("prior_test_failure")
    expect(elevenLabsSpeakRuntimeAllowed()).toBe(false)

    const confirmState = encodeTelnyxCallControlState({
      v: 1,
      phase: "await_busy_sms_confirm_end",
      userId: "u1",
      businessLineE164: "+15555571219",
      callerE164: "+15551230000",
      holdSpeakVoice: elevenLabsCallControlVoice(ELEVENLABS_VOICE_IDS.rachel),
      dialReason: "busy_automation",
      fallbackType: "voicemail",
    })

    const { handleTelnyxCallControlVoiceWebhook } = await import("@/lib/telnyx-call-control-inbound")
    await handleTelnyxCallControlVoiceWebhook({
      data: {
        event_type: "call.speak.ended",
        id: "evt-speak-end-elevenlabs-ok",
        payload: {
          call_control_id: "cc-speak-ok",
          from: "+15551230000",
          to: "+15555571219",
          direction: "incoming",
          client_state: confirmState,
        },
      },
    })

    expect(elevenLabsSpeakRuntimeAllowed()).toBe(true)
    resetElevenLabsSpeakCircuitForTests()
  })

  it("a missing customer-name lookup does not break the repeat-caller signal", async () => {
    resolveInboundCapturePlanMock.mockResolvedValue({ kind: "day_dial" })

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
          fallback_type: "hold",
          ring_timeout_seconds: 30,
          inbound_caller_greeting_enabled: true,
          account_status: "active",
          primary_phone_number: "+15025571219",
          active_phone_count: 1,
        })
      ),
      getRoutingConfigForNumber: vi.fn(),
      insertCallLog: vi.fn(),
      getCallLogSnapshotForTelemetry: vi.fn(() => Promise.resolve(null)),
      recordCallStatusEvent: vi.fn(() => Promise.resolve()),
      updateCallLog: vi.fn(() => Promise.resolve()),
      upsertTelnyxCallLegLink: vi.fn(() => Promise.resolve()),
      getTelnyxOutboundLegForInbound: vi.fn(() => Promise.resolve(null)),
      deleteTelnyxCallLegLink: vi.fn(() => Promise.resolve()),
      isReasonablePstnDialString: (s: string) => s.replace(/\D/g, "").length >= 10,
      normalizePhoneNumberE164: (p: string) => p,
      listTodaysCallLogsForCaller: vi.fn(() =>
        Promise.resolve([
          {
            id: "prior-missed-2",
            from_number: "+15025369252",
            created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
            call_type: "missed",
            status: "no-answer",
            answered_at: null,
            ended_at: new Date(Date.now() - 5 * 60_000).toISOString(),
          },
        ])
      ),
      // Deliberately no getCustomerByPhoneForUser export — simulates a lookup failure.
      // isRepeatCaller must still resolve correctly from its own independent try/catch.
    }))
    vi.doMock("@/lib/account-presence", () => ({
      getAccountPresence: vi.fn(() =>
        Promise.resolve({
          presenceStatus: "AVAILABLE",
          onJobGreetingText: "We are with another customer. Press 1 for a text, or stay on the line.",
          closedGreetingText: "",
          ivrBypassCode: "9",
          ivrVoiceEngineModel: "Telnyx.NaturalHD.astra",
          holidayOverrideStart: null,
          holidayOverrideEnd: null,
          holidayGreetingText: null,
        })
      ),
      resolvePresenceAutomationGreeting: vi.fn(() =>
        "We are with another customer. Press 1 for a text, or stay on the line."
      ),
    }))
    vi.doMock("@/lib/call-queue-db", () => ({
      upsertCallQueueBusyMenu: vi.fn(() => Promise.resolve(null)),
      countWaitingCallQueue: vi.fn(() => Promise.resolve(0)),
      upsertCallQueueWaiting: vi.fn(() => Promise.resolve(null)),
      getAccountHoldSettings: vi.fn(() =>
        Promise.resolve({ holdMusicUrl: null, holdMaxWaitSecs: null, holdRepromptSecs: null })
      ),
      getCallQueuePosition: vi.fn(() => Promise.resolve(1)),
      updateCallQueueStatus: vi.fn(() => Promise.resolve()),
      getCallQueueStatusByCallControlId: vi.fn(() => Promise.resolve("holding")),
      listWaitingCallQueue: vi.fn(() => Promise.resolve([])),
    }))

    const dialState = encodeTelnyxCallControlState({
      v: 1,
      phase: "await_dial_end",
      userId: "u1",
      businessLineE164: "+15025571219",
      callerE164: "+15025369252",
      dialTargetE164: "+15022602716",
      inboundCallControlId: "cc-in-partial",
      outboundCallControlId: "cc-out-partial",
      ringTimeoutSec: 30,
      fallbackType: "hold",
      dialReason: "day_dial",
    })

    const { handleTelnyxCallControlVoiceWebhook } = await import("@/lib/telnyx-call-control-inbound")
    await handleTelnyxCallControlVoiceWebhook({
      data: {
        event_type: "call.hangup",
        id: "evt-dial-na-partial",
        payload: {
          call_control_id: "cc-out-partial",
          from: "+15025571219",
          to: "+15022602716",
          direction: "outgoing",
          hangup_cause: "timeout",
          dial: { status: "no_answer" },
          client_state: dialState,
        },
      },
    })

    const gatherCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/actions/gather_using_speak")
    )
    expect(gatherCall).toBeTruthy()
    const gatherBody = JSON.parse(String(gatherCall![1]?.body || "{}")) as { payload?: string }
    expect(gatherBody.payload).toContain("Thanks for trying us again")
  })

  it("call.conversation.ended after the AI hold bridge sends the booking SMS and hangs up (087)", async () => {
    const sendSms = vi.fn((..._args: unknown[]) => Promise.resolve({ outcome: "sent" }))
    vi.doMock("@/lib/db", () => ({
      getIncomingRoutingForVoiceWebhook: vi.fn(() => Promise.resolve(null)),
    }))
    vi.doMock("@/lib/inbound-booking-sms", () => ({
      sendInboundBookingSmsAndTag: sendSms,
      bookingSmsConfirmSpeech: vi.fn(() => "mock booking sms confirm speech"),
    }))

    const aiHoldState = encodeTelnyxCallControlState({
      v: 1,
      phase: "await_ai_assistant_hold",
      userId: "u1",
      businessLineE164: "+15025571219",
      callerE164: "+15025369252",
      dialReason: "busy_automation",
    })

    const { handleTelnyxCallControlVoiceWebhook } = await import("@/lib/telnyx-call-control-inbound")
    await handleTelnyxCallControlVoiceWebhook({
      data: {
        event_type: "call.conversation.ended",
        id: "evt-ai-conversation-ended",
        payload: {
          call_control_id: "cc-ai-hold-1",
          client_state: aiHoldState,
        },
      },
    })

    expect(sendSms).toHaveBeenCalledTimes(1)
    expect(sendSms.mock.calls[0][0]).toMatchObject({
      callSid: "cc-ai-hold-1",
      source: "cc_busy_hold_ai_wrapup",
    })
    const hangupCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/actions/hangup"))
    expect(hangupCall).toBeTruthy()
  })

  it("call.conversation.ended is ignored outside the AI hold-bridge phase", async () => {
    const sendSms = vi.fn(() => Promise.resolve({ outcome: "sent" }))
    vi.doMock("@/lib/db", () => ({
      getIncomingRoutingForVoiceWebhook: vi.fn(() => Promise.resolve(null)),
    }))
    vi.doMock("@/lib/inbound-booking-sms", () => ({
      sendInboundBookingSmsAndTag: sendSms,
      bookingSmsConfirmSpeech: vi.fn(() => "mock booking sms confirm speech"),
    }))

    const dialState = encodeTelnyxCallControlState({
      v: 1,
      phase: "await_dial_end",
      userId: "u1",
      businessLineE164: "+15025571219",
      callerE164: "+15025369252",
    })

    const { handleTelnyxCallControlVoiceWebhook } = await import("@/lib/telnyx-call-control-inbound")
    await handleTelnyxCallControlVoiceWebhook({
      data: {
        event_type: "call.conversation.ended",
        id: "evt-ai-conversation-ended-wrong-phase",
        payload: {
          call_control_id: "cc-not-ai-hold",
          client_state: dialState,
        },
      },
    })

    expect(sendSms).not.toHaveBeenCalled()
    const hangupCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/actions/hangup"))
    expect(hangupCall).toBeFalsy()
  })
})
