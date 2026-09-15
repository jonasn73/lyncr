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
const sendHoldLongWaitOwnerAlert = vi.fn<AnyFn>()
const holdLongWaitAlertMs = vi.fn<AnyFn>()
const getCallQueueCollectedByCallControlId = vi.fn<AnyFn>()
const getRecentHoldIntakeForCaller = vi.fn<AnyFn>()
const saveCallIntake = vi.fn<AnyFn>()

vi.mock("@/lib/call-queue-db", () => ({
  countWaitingCallQueue: vi.fn(() => Promise.resolve(0)),
  getAccountHoldSettings: vi.fn(() => Promise.resolve(null)),
  getCallQueueCollectedByCallControlId: (...args: unknown[]) =>
    getCallQueueCollectedByCallControlId(...args),
  getCallQueuePosition: vi.fn(() => Promise.resolve(null)),
  getCallQueueStatusByCallControlId: (...args: unknown[]) =>
    getCallQueueStatusByCallControlId(...args),
  getRecentHoldIntakeForCaller: (...args: unknown[]) => getRecentHoldIntakeForCaller(...args),
  mergeCallQueueCollected: vi.fn(() => Promise.resolve()),
  updateCallQueueStatus: (...args: unknown[]) => updateCallQueueStatus(...args),
  upsertCallQueueWaiting: vi.fn(() => Promise.resolve()),
}))

vi.mock("@/lib/intake-engine", () => ({
  saveCallIntake: (...args: unknown[]) => saveCallIntake(...args),
}))

vi.mock("@/lib/account-presence", () => ({
  getAccountPresence: vi.fn(() =>
    Promise.resolve({ presenceStatus: "AVAILABLE", presenceClosedManual: false })
  ),
}))

vi.mock("@/lib/hold-queue", () => ({
  HOLD_REPROMPT_DEFAULT: "Still here — thanks for waiting.",
  HOLD_REPROMPT_ALREADY_ANSWERED: "Thanks for those details. Press 1 to book by text, press 2 for a callback.",
  HOLD_REPROMPT_KNOWN_CUSTOMER: "Our team members are still tied up. Press 1 for a text, press 2 for a callback.",
  HOLD_VEHICLE_CHANGED_PROMPT: "Has anything changed since we last spoke? Press 1 if yes, press 2 if no.",
  HOLD_VEHICLE_NO_CHANGE_REPROMPT: "Our team members are still tied up right now. Stay on the line, or press 2 for a callback.",
  holdVehicleConfirmPrompt: (vehicle: string) =>
    `If you're calling about your ${vehicle}, press 1. If not, press 2.`,
  holdLongWaitAlertMs: (...args: unknown[]) => holdLongWaitAlertMs(...args),
  holdMaxConcurrent: vi.fn(() => 5),
  holdMaxWaitSecs: vi.fn((override?: number) => override ?? 40),
  holdMusicMediaName: vi.fn(() => "hold-music.mp3"),
  holdRePromptIntervalMs: vi.fn(() => 30_000),
  lyncrHoldQueueName: vi.fn((userId: string) => `lyncr-${userId}`),
  resolveHoldMusicUrlCandidates: vi.fn(() => []),
}))

vi.mock("@/lib/hold-long-wait-alert", () => ({
  sendHoldLongWaitOwnerAlert: (...args: unknown[]) => sendHoldLongWaitOwnerAlert(...args),
}))

vi.mock("@/lib/hold-inline-audio", () => ({
  loadHoldMusicPlaybackContentBase64: vi.fn(() => Promise.resolve(null)),
}))

vi.mock("@/lib/inbound-booking-sms", () => ({
  bookingSmsConfirmSpeech: (...args: unknown[]) => bookingSmsConfirmSpeech(...args),
  sendInboundBookingSmsAndTag: (...args: unknown[]) => sendInboundBookingSmsAndTag(...args),
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
  normalizePhoneNumberE164: (p: string) => {
    const d = p.replace(/\D/g, "")
    if (d.length === 10) return `+1${d}`
    return p.startsWith("+") ? p : `+${d}`
  },
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
  sendHoldLongWaitOwnerAlert.mockResolvedValue({ ok: true, sent: true })
  holdLongWaitAlertMs.mockReturnValue(999_000)
  getCallQueueCollectedByCallControlId.mockResolvedValue({})
  getRecentHoldIntakeForCaller.mockResolvedValue(null)
  saveCallIntake.mockResolvedValue({ id: "lead-1", sms_sent: true, sms_error: null })
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

describe("hold-queue long-wait owner alert", () => {
  it("texts the owner once a waiting caller crosses the alert threshold", async () => {
    holdLongWaitAlertMs.mockReturnValue(5_000)

    await handleHoldLoopGatherEnded({
      callControlId: "cc-long-wait",
      state: { ...timedOutState(), holdStartedAtMs: Date.now() - 10_000, holdSegment: "music" },
      digits: "",
      gatherStatus: "timeout",
    })

    expect(sendHoldLongWaitOwnerAlert).toHaveBeenCalledTimes(1)
    expect(sendHoldLongWaitOwnerAlert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "owner-1", callerE164: "+15025559999" })
    )
  })

  it("never fires twice for the same call (holdLongWaitAlerted already set)", async () => {
    holdLongWaitAlertMs.mockReturnValue(5_000)

    await handleHoldLoopGatherEnded({
      callControlId: "cc-long-wait-2",
      state: {
        ...timedOutState(),
        holdStartedAtMs: Date.now() - 20_000,
        holdSegment: "music",
        holdLongWaitAlerted: true,
      },
      digits: "",
      gatherStatus: "timeout",
    })

    expect(sendHoldLongWaitOwnerAlert).not.toHaveBeenCalled()
  })

  it("does not fire before the threshold is crossed", async () => {
    holdLongWaitAlertMs.mockReturnValue(60_000)

    await handleHoldLoopGatherEnded({
      callControlId: "cc-not-yet",
      state: { ...timedOutState(), holdStartedAtMs: Date.now() - 5_000, holdSegment: "music" },
      digits: "",
      gatherStatus: "timeout",
    })

    expect(sendHoldLongWaitOwnerAlert).not.toHaveBeenCalled()
  })
})

describe("hold-queue callback request (press 2)", () => {
  it("pressing 2 during a plain reprompt starts the callback-number confirm", async () => {
    await handleHoldLoopGatherEnded({
      callControlId: "cc-cb-start",
      state: { ...timedOutState(), holdStartedAtMs: Date.now() },
      digits: "2",
      gatherStatus: "valid",
    })

    expect(telnyxCallControlGatherUsingSpeak).toHaveBeenCalledTimes(1)
    const [callControlId, opts] = telnyxCallControlGatherUsingSpeak.mock.calls[0]
    expect(callControlId).toBe("cc-cb-start")
    expect(opts.text).toContain("5 0 2 5 5 5 9 9 9 9")
    expect(opts.validDigits).toBe("12")
    // Not yet a lead — only the confirm step, no save/leave yet.
    expect(saveCallIntake).not.toHaveBeenCalled()
  })

  it("confirming with 1 finalizes a callback lead using the caller's own number", async () => {
    await handleHoldLoopGatherEnded({
      callControlId: "cc-cb-confirm",
      state: {
        ...timedOutState(),
        holdStartedAtMs: Date.now(),
        holdAwaitingCallbackConfirm: true,
        holdIntakeSummary: "Won't start / stranded — Year 2018",
      },
      digits: "1",
      gatherStatus: "valid",
    })

    expect(telnyxCallControlLeaveQueue).toHaveBeenCalledTimes(1)
    expect(updateCallQueueStatus).toHaveBeenCalledWith(
      expect.objectContaining({ callControlId: "cc-cb-confirm", status: "left" })
    )
    expect(saveCallIntake).toHaveBeenCalledTimes(1)
    expect(saveCallIntake.mock.calls[0][0]).toMatchObject({
      user_id: "owner-1",
      caller_e164: "+15025559999",
      summary: "Callback requested — Won't start / stranded — Year 2018",
      collected: expect.objectContaining({ callback_requested: true, callback_number: "+15025559999" }),
    })
    expect(telnyxCallControlSpeak).toHaveBeenCalledTimes(1)
    expect(String(telnyxCallControlSpeak.mock.calls[0][1])).toContain("we'll call you back")
    expect(telnyxCallControlHangup).not.toHaveBeenCalled()
  })

  it("pressing 2 to confirm instead asks for a different number", async () => {
    await handleHoldLoopGatherEnded({
      callControlId: "cc-cb-different",
      state: { ...timedOutState(), holdStartedAtMs: Date.now(), holdAwaitingCallbackConfirm: true },
      digits: "2",
      gatherStatus: "valid",
    })

    expect(saveCallIntake).not.toHaveBeenCalled()
    expect(telnyxCallControlGatherUsingSpeak).toHaveBeenCalledTimes(1)
    const [, opts] = telnyxCallControlGatherUsingSpeak.mock.calls[0]
    expect(opts.maximumDigits).toBe(10)
    expect(opts.validDigits).toBe("0123456789")
  })

  it("a typed replacement number finalizes the lead with that number instead", async () => {
    await handleHoldLoopGatherEnded({
      callControlId: "cc-cb-typed",
      state: { ...timedOutState(), holdStartedAtMs: Date.now(), holdAwaitingCallbackNumber: true },
      digits: "5025550123",
      gatherStatus: "valid",
    })

    expect(saveCallIntake).toHaveBeenCalledTimes(1)
    expect(saveCallIntake.mock.calls[0][0]).toMatchObject({
      caller_e164: "+15025550123",
      collected: expect.objectContaining({ callback_number: "+15025550123" }),
    })
  })

  it("a timed-out/too-short replacement number falls back to the caller's own number", async () => {
    await handleHoldLoopGatherEnded({
      callControlId: "cc-cb-fallback",
      state: { ...timedOutState(), holdStartedAtMs: Date.now(), holdAwaitingCallbackNumber: true },
      digits: "",
      gatherStatus: "timeout",
    })

    expect(saveCallIntake).toHaveBeenCalledTimes(1)
    expect(saveCallIntake.mock.calls[0][0]).toMatchObject({
      caller_e164: "+15025559999",
      collected: expect.objectContaining({ callback_number: "+15025559999" }),
    })
  })

  it("carries forward whatever was already collected on hold into the lead", async () => {
    getCallQueueCollectedByCallControlId.mockResolvedValue({
      intent_slug: "auto_repair_diagnostic",
      vehicle_year: "2018",
    })

    await handleHoldLoopGatherEnded({
      callControlId: "cc-cb-collected",
      state: { ...timedOutState(), holdStartedAtMs: Date.now(), holdAwaitingCallbackConfirm: true },
      digits: "1",
      gatherStatus: "valid",
    })

    expect(saveCallIntake.mock.calls[0][0]).toMatchObject({
      intent_slug: "auto_repair_diagnostic",
      collected: expect.objectContaining({ vehicle_year: "2018", callback_requested: true }),
    })
  })

  it("regression: the post-intake reprompt gather itself accepts digit 2, not just \"1\"", async () => {
    // A real call got stuck in a loop: the reprompt copy said "press 2 for a callback"
    // but the gather that played it was still configured to accept only "1" as valid
    // DTMF, so every press of 2 came back gatherStatus=invalid and just replayed the
    // same reprompt. This asserts the actual gather config, not just the digit-2 handler.
    getUser.mockResolvedValue({ industry: "locksmith" })

    await handleHoldLoopGatherEnded({
      callControlId: "cc-reprompt-validdigits",
      state: {
        ...timedOutState(),
        holdStartedAtMs: Date.now(),
        holdSegment: "music",
        holdIntakeAnswered: true,
        holdIntakeFollowUpAnswered: true,
      },
      digits: "",
      gatherStatus: "timeout",
    })

    expect(telnyxCallControlGatherUsingSpeak).toHaveBeenCalledTimes(1)
    const [, opts] = telnyxCallControlGatherUsingSpeak.mock.calls[0]
    expect(opts.validDigits).toBe("12")
  })
})

describe("hold-queue reuses a recent caller's prior answers instead of re-asking", () => {
  it("skips the intake question on a callback and speaks the already-answered reprompt", async () => {
    getRecentHoldIntakeForCaller.mockResolvedValue({
      collected: { intent_label: "Lost key / needs new key made", vehicle_year_label: "Year 2016" },
      minutesAgo: 120,
    })

    await handleHoldLoopGatherEnded({
      callControlId: "cc-repeat-caller",
      state: { ...timedOutState(), holdStartedAtMs: Date.now(), holdSegment: "music" },
      digits: "",
      gatherStatus: "timeout",
    })

    expect(getRecentHoldIntakeForCaller).toHaveBeenCalledWith(
      "owner-1",
      "+15025559999",
      "cc-repeat-caller"
    )
    // Never asked the Phase-1 question — getUser (industry lookup) is only reached when
    // intake is still unanswered, so it must not have fired here.
    expect(getUser).not.toHaveBeenCalled()
    expect(telnyxCallControlGatherUsingSpeak).toHaveBeenCalledTimes(1)
    const [, opts] = telnyxCallControlGatherUsingSpeak.mock.calls[0]
    expect(opts.text).toContain("Thanks for those details")
    expect(opts.validDigits).toBe("12")
  })

  it("carries the reused summary onto state for the SMS/callback lead", async () => {
    getRecentHoldIntakeForCaller.mockResolvedValue({
      collected: { intent_label: "Won't start / stranded", vehicle_year_label: "Year 2018" },
      minutesAgo: 120,
    })

    await handleHoldLoopGatherEnded({
      callControlId: "cc-repeat-caller-2",
      state: { ...timedOutState(), holdStartedAtMs: Date.now(), holdSegment: "music" },
      digits: "",
      gatherStatus: "timeout",
    })

    // Decode the client_state passed to the reprompt gather and confirm the summary landed.
    const opts = telnyxCallControlGatherUsingSpeak.mock.calls[0][1]
    const decoded = JSON.parse(Buffer.from(opts.clientState, "base64").toString("utf8"))
    expect(decoded.holdIntakeSummary).toBe("Won't start / stranded — Year 2018")
    expect(decoded.holdIntakeAnswered).toBe(true)
    expect(decoded.holdIntakeFollowUpAnswered).toBe(true)
  })

  it("still asks normally when there's no recent history for this caller", async () => {
    getRecentHoldIntakeForCaller.mockResolvedValue(null)
    getUser.mockResolvedValue({ industry: "roofing" })

    await handleHoldLoopGatherEnded({
      callControlId: "cc-fresh-caller",
      state: { ...timedOutState(), holdStartedAtMs: Date.now(), holdSegment: "music" },
      digits: "",
      gatherStatus: "timeout",
    })

    expect(getRecentHoldIntakeForCaller).toHaveBeenCalledTimes(1)
    expect(getUser).toHaveBeenCalledTimes(1)
    const opts = telnyxCallControlGatherUsingSpeak.mock.calls[0][1]
    expect(opts.text).toContain("active leak")
  })

  it("only checks history once — not on a later reprompt cycle within the same call", async () => {
    await handleHoldLoopGatherEnded({
      callControlId: "cc-cycle-two",
      state: {
        ...timedOutState(),
        holdStartedAtMs: Date.now(),
        holdSegment: "music",
        holdPromptCount: 1,
        holdIntakeAnswered: true,
      },
      digits: "",
      gatherStatus: "timeout",
    })

    expect(getRecentHoldIntakeForCaller).not.toHaveBeenCalled()
  })
})

describe("hold-queue skips intake for any known customer, not just recent DTMF answers", () => {
  it("skips the question for a known customer with no recent hold-queue history", async () => {
    getRecentHoldIntakeForCaller.mockResolvedValue(null)

    await handleHoldLoopGatherEnded({
      callControlId: "cc-known-customer",
      state: {
        ...timedOutState(),
        holdStartedAtMs: Date.now(),
        holdSegment: "music",
        isKnownCustomer: true,
      },
      digits: "",
      gatherStatus: "timeout",
    })

    expect(getUser).not.toHaveBeenCalled()
    const opts = telnyxCallControlGatherUsingSpeak.mock.calls[0][1]
    // Known-customer skip has no specific summary to reference, so it must use the
    // "team members are still tied up" copy, not the "thanks for those details" one
    // (which would falsely imply they just answered something on this call).
    expect(opts.text).toContain("Our team members are still tied up")
    expect(opts.text).not.toContain("Thanks for those details")
    expect(opts.validDigits).toBe("12")
  })

  it("prefers a specific recent-answers match over the generic known-customer copy", async () => {
    getRecentHoldIntakeForCaller.mockResolvedValue({
      collected: { intent_label: "Active leak" },
      minutesAgo: 120,
    })

    await handleHoldLoopGatherEnded({
      callControlId: "cc-known-customer-with-history",
      state: {
        ...timedOutState(),
        holdStartedAtMs: Date.now(),
        holdSegment: "music",
        isKnownCustomer: true,
      },
      digits: "",
      gatherStatus: "timeout",
    })

    const opts = telnyxCallControlGatherUsingSpeak.mock.calls[0][1]
    expect(opts.text).toContain("Thanks for those details")
  })

  it("still asks normally when the caller is neither a known customer nor has recent history", async () => {
    getRecentHoldIntakeForCaller.mockResolvedValue(null)
    getUser.mockResolvedValue({ industry: "plumbing" })

    await handleHoldLoopGatherEnded({
      callControlId: "cc-unknown-caller",
      state: { ...timedOutState(), holdStartedAtMs: Date.now(), holdSegment: "music", isKnownCustomer: false },
      digits: "",
      gatherStatus: "timeout",
    })

    const opts = telnyxCallControlGatherUsingSpeak.mock.calls[0][1]
    expect(opts.text).toContain("leak or flooding")
  })
})

describe("hold-queue never speaks recognition — same reprompt copy regardless of recency", () => {
  it("uses the plain already-answered copy for a match minutes ago (no 'welcome back')", async () => {
    getRecentHoldIntakeForCaller.mockResolvedValue({
      collected: { intent_label: "Lost key / needs new key made" },
      minutesAgo: 8,
    })

    await handleHoldLoopGatherEnded({
      callControlId: "cc-just-called",
      state: { ...timedOutState(), holdStartedAtMs: Date.now(), holdSegment: "music" },
      digits: "",
      gatherStatus: "timeout",
    })

    const opts = telnyxCallControlGatherUsingSpeak.mock.calls[0][1]
    expect(opts.text).not.toContain("Welcome back")
    expect(opts.text).not.toContain("welcome back")
    expect(opts.text).toContain("Thanks for those details")
  })

  it("uses the same copy for a match a couple hours ago", async () => {
    getRecentHoldIntakeForCaller.mockResolvedValue({
      collected: { intent_label: "Lost key / needs new key made" },
      minutesAgo: 150,
    })

    await handleHoldLoopGatherEnded({
      callControlId: "cc-hours-later",
      state: { ...timedOutState(), holdStartedAtMs: Date.now(), holdSegment: "music" },
      digits: "",
      gatherStatus: "timeout",
    })

    const opts = telnyxCallControlGatherUsingSpeak.mock.calls[0][1]
    expect(opts.text).not.toContain("Welcome back")
    expect(opts.text).toContain("Thanks for those details")
  })

  it("never invites an already-known customer to 'book' by text", async () => {
    getRecentHoldIntakeForCaller.mockResolvedValue(null)

    await handleHoldLoopGatherEnded({
      callControlId: "cc-no-book-language",
      state: { ...timedOutState(), holdStartedAtMs: Date.now(), holdSegment: "music", isKnownCustomer: true },
      digits: "",
      gatherStatus: "timeout",
    })

    const opts = telnyxCallControlGatherUsingSpeak.mock.calls[0][1]
    expect(opts.text).not.toContain("book by text")
    expect(opts.text).toContain("Press 1 for a text")
  })
})

describe("hold-queue vehicle-confirm — names the specific vehicle on file instead of any recognition wording", () => {
  it("asks about the vehicle on file before anything else, once, with no 'we know you' language", async () => {
    getRecentHoldIntakeForCaller.mockResolvedValue(null)

    await handleHoldLoopGatherEnded({
      callControlId: "cc-vehicle-on-file",
      state: {
        ...timedOutState(),
        holdStartedAtMs: Date.now(),
        holdSegment: "music",
        isKnownCustomer: true,
        holdVehicleOnFile: "2016 Chrysler 200",
      },
      digits: "",
      gatherStatus: "timeout",
    })

    expect(getUser).not.toHaveBeenCalled()
    expect(getRecentHoldIntakeForCaller).not.toHaveBeenCalled()
    const opts = telnyxCallControlGatherUsingSpeak.mock.calls[0][1]
    expect(opts.text).toBe("If you're calling about your 2016 Chrysler 200, press 1. If not, press 2.")
    expect(opts.text).not.toMatch(/welcome back/i)
    expect(opts.text).not.toMatch(/recogni/i)
    expect(opts.validDigits).toBe("12")
    const decoded = JSON.parse(Buffer.from(opts.clientState, "base64").toString("utf8"))
    expect(decoded.holdVehicleConfirmOffered).toBe(true)
    expect(decoded.holdAwaitingVehicleConfirm).toBe(true)
  })

  it("press 1 (confirmed) asks whether anything changed next", async () => {
    await handleHoldLoopGatherEnded({
      callControlId: "cc-vehicle-confirmed",
      state: {
        ...timedOutState(),
        holdVehicleOnFile: "2016 Chrysler 200",
        holdVehicleConfirmOffered: true,
        holdAwaitingVehicleConfirm: true,
      },
      digits: "1",
      gatherStatus: "digit",
    })

    const opts = telnyxCallControlGatherUsingSpeak.mock.calls[0][1]
    expect(opts.text).toContain("anything changed")
    expect(opts.validDigits).toBe("12")
    const decoded = JSON.parse(Buffer.from(opts.clientState, "base64").toString("utf8"))
    expect(decoded.holdAwaitingVehicleConfirm).toBe(false)
    expect(decoded.holdAwaitingVehicleChangedAnswer).toBe(true)
  })

  it("press 2 (not that vehicle) falls through to the normal reprompt/intake flow, never re-asking", async () => {
    getUser.mockResolvedValue({ industry: "plumbing" })
    getRecentHoldIntakeForCaller.mockResolvedValue(null)

    await handleHoldLoopGatherEnded({
      callControlId: "cc-vehicle-declined",
      state: {
        ...timedOutState(),
        holdStartedAtMs: Date.now(),
        holdVehicleOnFile: "2016 Chrysler 200",
        holdVehicleConfirmOffered: true,
        holdAwaitingVehicleConfirm: true,
      },
      digits: "2",
      gatherStatus: "digit",
    })

    const opts = telnyxCallControlGatherUsingSpeak.mock.calls[0][1]
    expect(opts.text).toContain("leak or flooding")
    const decoded = JSON.parse(Buffer.from(opts.clientState, "base64").toString("utf8"))
    expect(decoded.holdVehicleConfirmOffered).toBe(true)
    expect(decoded.holdAwaitingVehicleConfirm).toBeFalsy()
  })

  it("changed=yes (press 1) sends the booking-link SMS instead of re-asking anything", async () => {
    sendInboundBookingSmsAndTag.mockResolvedValue({ outcome: "sent" })
    bookingSmsConfirmSpeech.mockReturnValue("We texted you a link.")

    await handleHoldLoopGatherEnded({
      callControlId: "cc-vehicle-changed-yes",
      state: {
        ...timedOutState(),
        holdVehicleOnFile: "2016 Chrysler 200",
        holdVehicleConfirmOffered: true,
        holdAwaitingVehicleChangedAnswer: true,
      },
      digits: "1",
      gatherStatus: "digit",
    })

    expect(sendInboundBookingSmsAndTag).toHaveBeenCalled()
    expect(telnyxCallControlSpeak).toHaveBeenCalled()
  })

  it("changed=no (press 2) skips straight to status/wait-or-callback with no re-ask", async () => {
    await handleHoldLoopGatherEnded({
      callControlId: "cc-vehicle-changed-no",
      state: {
        ...timedOutState(),
        holdVehicleOnFile: "2016 Chrysler 200",
        holdVehicleConfirmOffered: true,
        holdAwaitingVehicleChangedAnswer: true,
      },
      digits: "2",
      gatherStatus: "digit",
    })

    expect(sendInboundBookingSmsAndTag).not.toHaveBeenCalled()
    const opts = telnyxCallControlGatherUsingSpeak.mock.calls[0][1]
    expect(opts.text).toContain("still tied up")
    expect(opts.text).toContain("press 2 for a callback")
    const decoded = JSON.parse(Buffer.from(opts.clientState, "base64").toString("utf8"))
    expect(decoded.holdIntakeAnswered).toBe(true)
    expect(decoded.holdAwaitingVehicleChangedAnswer).toBe(false)
  })
})
