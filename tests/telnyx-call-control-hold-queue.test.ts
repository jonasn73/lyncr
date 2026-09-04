import { describe, expect, it, vi, beforeEach } from "vitest"

type AnyFn = (...args: any[]) => any

const updateCallQueueStatus = vi.fn<AnyFn>()
const getCallQueueStatusByCallControlId = vi.fn<AnyFn>()
const resolveAiVoiceAssistantEntitlement = vi.fn<AnyFn>()
const getUser = vi.fn<AnyFn>()
const updateCallLog = vi.fn<AnyFn>()
const sendInboundBookingSmsAndTag = vi.fn<AnyFn>()
const bookingSmsConfirmSpeech = vi.fn<AnyFn>()
const telnyxCallControlPlaybackStop = vi.fn<AnyFn>()
const telnyxCallControlLeaveQueue = vi.fn<AnyFn>()
const telnyxCallControlHangup = vi.fn<AnyFn>()
const telnyxCallControlSpeak = vi.fn<AnyFn>()
const telnyxCallControlGatherUsingSpeak = vi.fn<AnyFn>()
const telnyxCallControlStartAiAssistant = vi.fn<AnyFn>()
const telnyxCallControlStopAiAssistant = vi.fn<AnyFn>()

vi.mock("@/lib/call-queue-db", () => ({
  countWaitingCallQueue: vi.fn(() => Promise.resolve(0)),
  getAccountHoldSettings: vi.fn(() => Promise.resolve(null)),
  getCallQueuePosition: vi.fn(() => Promise.resolve(null)),
  getCallQueueStatusByCallControlId: (...args: unknown[]) =>
    getCallQueueStatusByCallControlId(...args),
  updateCallQueueStatus: (...args: unknown[]) => updateCallQueueStatus(...args),
  upsertCallQueueWaiting: vi.fn(() => Promise.resolve()),
}))

vi.mock("@/lib/account-presence", () => ({
  getAccountPresence: vi.fn(() =>
    Promise.resolve({ presenceStatus: "AVAILABLE", presenceClosedManual: false })
  ),
}))

vi.mock("@/lib/hold-queue", () => ({
  HOLD_REPROMPT_DEFAULT: "Still here — thanks for waiting.",
  holdMaxConcurrent: vi.fn(() => 5),
  holdMaxWaitSecs: vi.fn((override?: number) => override ?? 40),
  holdMusicMediaName: vi.fn(() => "hold-music.mp3"),
  holdRePromptIntervalMs: vi.fn(() => 30_000),
  lyncrHoldQueueName: vi.fn((userId: string) => `lyncr-${userId}`),
  resolveHoldMusicUrlCandidates: vi.fn(() => []),
}))

vi.mock("@/lib/hold-inline-audio", () => ({
  loadHoldMusicPlaybackContentBase64: vi.fn(() => Promise.resolve(null)),
}))

vi.mock("@/lib/inbound-booking-sms", () => ({
  bookingSmsConfirmSpeech: (...args: unknown[]) => bookingSmsConfirmSpeech(...args),
  sendInboundBookingSmsAndTag: (...args: unknown[]) => sendInboundBookingSmsAndTag(...args),
}))

vi.mock("@/lib/elevenlabs-voices", () => ({
  preferWorkingSpeakVoice: vi.fn((v?: string) => v || "Telnyx.NaturalHD.astra"),
}))

vi.mock("@/lib/ivr-automation-settings", () => ({
  resolveSpeakVoiceForPersona: vi.fn(() => "Telnyx.NaturalHD.astra"),
}))

vi.mock("@/lib/ai-voice-entitlement", () => ({
  resolveAiVoiceAssistantEntitlement: (...args: unknown[]) =>
    resolveAiVoiceAssistantEntitlement(...args),
}))

vi.mock("@/lib/telnyx-call-control-api", () => ({
  markTelnyxCallControlTerminal: vi.fn(),
  telnyxCallControlBridge: vi.fn(() => Promise.resolve({ ok: true })),
  telnyxCallControlGather: vi.fn(() => Promise.resolve({ ok: true })),
  telnyxCallControlGatherStop: vi.fn(() => Promise.resolve({ ok: true })),
  telnyxCallControlGatherUsingAudio: vi.fn(() => Promise.resolve({ ok: true })),
  telnyxCallControlGatherUsingSpeak: (...args: unknown[]) => telnyxCallControlGatherUsingSpeak(...args),
  telnyxCallControlHangup: (...args: unknown[]) => telnyxCallControlHangup(...args),
  telnyxCallControlLeaveQueue: (...args: unknown[]) => telnyxCallControlLeaveQueue(...args),
  telnyxCallControlPlaybackStart: vi.fn(() => Promise.resolve({ ok: true })),
  telnyxCallControlPlaybackStop: (...args: unknown[]) => telnyxCallControlPlaybackStop(...args),
  telnyxCallControlSpeak: (...args: unknown[]) => telnyxCallControlSpeak(...args),
  telnyxCallControlStartAiAssistant: (...args: unknown[]) => telnyxCallControlStartAiAssistant(...args),
  telnyxCallControlStopAiAssistant: (...args: unknown[]) => telnyxCallControlStopAiAssistant(...args),
}))

vi.mock("@/lib/db", () => ({
  getUser: (...args: unknown[]) => getUser(...args),
  updateCallLog: (...args: unknown[]) => updateCallLog(...args),
}))

import { handleHoldLoopGatherEnded } from "@/lib/telnyx-call-control-hold-queue"
import type { TelnyxCallControlClientState } from "@/lib/telnyx-call-control-state"

function timedOutState(): TelnyxCallControlClientState {
  return {
    v: 1,
    phase: "await_busy_hold_loop",
    userId: "owner-1",
    businessLineE164: "+15025551219",
    callerE164: "+15025559999",
    holdStartedAtMs: Date.now() - 10 * 60 * 1000,
    holdMaxWaitSecs: 40,
    holdSegment: "music",
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  updateCallQueueStatus.mockResolvedValue(undefined)
  getCallQueueStatusByCallControlId.mockResolvedValue("holding")
  updateCallLog.mockResolvedValue(undefined)
  bookingSmsConfirmSpeech.mockReturnValue("mock booking sms confirm speech")
  telnyxCallControlPlaybackStop.mockResolvedValue({ ok: true })
  telnyxCallControlLeaveQueue.mockResolvedValue({ ok: true })
  telnyxCallControlHangup.mockResolvedValue({ ok: true })
  telnyxCallControlSpeak.mockResolvedValue({ ok: true })
  telnyxCallControlGatherUsingSpeak.mockResolvedValue({ ok: true })
  telnyxCallControlStopAiAssistant.mockResolvedValue({ ok: true })
  telnyxCallControlStartAiAssistant.mockResolvedValue({ ok: true })
  sendInboundBookingSmsAndTag.mockResolvedValue({ outcome: "sent" })
})

describe("hold-queue max-wait AI bridge (087)", () => {
  it("bridges to the AI Assistant when the account is entitled and has one configured", async () => {
    resolveAiVoiceAssistantEntitlement.mockResolvedValue({ tier: "professional", allowed: true })
    getUser.mockResolvedValue({ telnyx_ai_assistant_id: "abc12345-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })

    await handleHoldLoopGatherEnded({
      callControlId: "cc-1",
      state: timedOutState(),
      digits: "",
      gatherStatus: "timeout",
    })

    expect(telnyxCallControlStartAiAssistant).toHaveBeenCalledTimes(1)
    const [callControlId, params] = telnyxCallControlStartAiAssistant.mock.calls[0]
    expect(callControlId).toBe("cc-1")
    expect(params.assistantId).toBe("abc12345-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    expect(updateCallLog).toHaveBeenCalledWith("cc-1", { routed_to_name: "AI Assistant (from hold)" })
    // Guaranteed-SMS fallback path must NOT also fire when the AI bridge succeeds.
    expect(sendInboundBookingSmsAndTag).not.toHaveBeenCalled()
    expect(telnyxCallControlHangup).not.toHaveBeenCalled()
  })

  it("falls back to the booking-link SMS when the account is not entitled", async () => {
    resolveAiVoiceAssistantEntitlement.mockResolvedValue({ tier: "starter", allowed: false })
    getUser.mockResolvedValue({ telnyx_ai_assistant_id: "abc12345-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })

    await handleHoldLoopGatherEnded({
      callControlId: "cc-2",
      state: timedOutState(),
      digits: "",
      gatherStatus: "timeout",
    })

    expect(telnyxCallControlStartAiAssistant).not.toHaveBeenCalled()
    expect(sendInboundBookingSmsAndTag).toHaveBeenCalledTimes(1)
    expect(sendInboundBookingSmsAndTag.mock.calls[0][0]).toMatchObject({
      callSid: "cc-2",
      source: "cc_busy_hold_max_wait",
    })
  })

  it("falls back to the booking-link SMS when entitled but no AI Assistant is configured yet", async () => {
    resolveAiVoiceAssistantEntitlement.mockResolvedValue({ tier: "business", allowed: true })
    getUser.mockResolvedValue({ telnyx_ai_assistant_id: null })

    await handleHoldLoopGatherEnded({
      callControlId: "cc-3",
      state: timedOutState(),
      digits: "",
      gatherStatus: "timeout",
    })

    expect(telnyxCallControlStartAiAssistant).not.toHaveBeenCalled()
    expect(sendInboundBookingSmsAndTag).toHaveBeenCalledTimes(1)
  })

  it("falls back to the booking-link SMS when the AI Assistant fails to start", async () => {
    resolveAiVoiceAssistantEntitlement.mockResolvedValue({ tier: "professional", allowed: true })
    getUser.mockResolvedValue({ telnyx_ai_assistant_id: "abc12345-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })
    telnyxCallControlStartAiAssistant.mockResolvedValue({ ok: false, status: 500, error: "boom" })

    await handleHoldLoopGatherEnded({
      callControlId: "cc-4",
      state: timedOutState(),
      digits: "",
      gatherStatus: "timeout",
    })

    expect(telnyxCallControlStartAiAssistant).toHaveBeenCalledTimes(1)
    expect(sendInboundBookingSmsAndTag).toHaveBeenCalledTimes(1)
  })
})

describe("hold-queue gather-ended stale-event guard", () => {
  it("ignores a gather-ended event once the queue row is already answered", async () => {
    getCallQueueStatusByCallControlId.mockResolvedValue("answered")

    await handleHoldLoopGatherEnded({
      callControlId: "cc-answered",
      state: { ...timedOutState(), holdStartedAtMs: Date.now() },
      digits: "",
      gatherStatus: "timeout",
    })

    expect(telnyxCallControlGatherUsingSpeak).not.toHaveBeenCalled()
    expect(telnyxCallControlStartAiAssistant).not.toHaveBeenCalled()
    expect(sendInboundBookingSmsAndTag).not.toHaveBeenCalled()
    expect(telnyxCallControlHangup).not.toHaveBeenCalled()
  })

  it("ignores a gather-ended event once the queue row already left", async () => {
    getCallQueueStatusByCallControlId.mockResolvedValue("left")

    await handleHoldLoopGatherEnded({
      callControlId: "cc-left",
      state: { ...timedOutState(), holdStartedAtMs: Date.now() },
      digits: "1",
      gatherStatus: "timeout",
    })

    expect(telnyxCallControlLeaveQueue).not.toHaveBeenCalled()
    expect(sendInboundBookingSmsAndTag).not.toHaveBeenCalled()
  })

  it("still processes a fresh gather-ended event while the caller is genuinely holding", async () => {
    getCallQueueStatusByCallControlId.mockResolvedValue("holding")

    await handleHoldLoopGatherEnded({
      callControlId: "cc-holding",
      state: { ...timedOutState(), holdStartedAtMs: Date.now(), holdSegment: "music" },
      digits: "",
      gatherStatus: "timeout",
    })

    expect(telnyxCallControlGatherUsingSpeak).toHaveBeenCalledTimes(1)
  })
})
