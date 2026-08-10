import { afterEach, describe, expect, it } from "vitest"
import {
  digitsMatchIvrBypass,
  defaultIvrVoiceEngineModel,
  ELEVENLABS_DEFAULT_IVR_VOICE_ENGINE_MODEL,
  isHolidayOverrideActive,
  IVR_VOICE_PERSONA_OPTIONS,
  normalizeIvrBypassCode,
  resolveAutomationGatherNumDigits,
  resolveHolidayGreetingText,
  resolveIvrCallControlVoice,
  resolveIvrTexmlVoice,
  resolveSpeakVoiceForPersona,
} from "@/lib/ivr-automation-settings"
import { buildAutomationPresenceGatherXml } from "@/lib/ivr-automation-texml"
import { DEFAULT_ACCOUNT_PRESENCE } from "@/lib/account-presence"
import {
  ELEVENLABS_VOICE_IDS,
  elevenLabsCallControlVoice,
  markElevenLabsSpeakFailed,
  normalizeElevenLabsCallControlVoice,
  resetElevenLabsSpeakCircuitForTests,
} from "@/lib/elevenlabs-voices"

describe("ivr automation settings", () => {
  const prevEleven = process.env.ELEVENLABS_API_KEY
  const prevRef = process.env.TELNYX_ELEVENLABS_API_KEY_REF
  const prevDisabled = process.env.LYNCR_ELEVENLABS_DISABLED

  afterEach(() => {
    if (prevEleven === undefined) delete process.env.ELEVENLABS_API_KEY
    else process.env.ELEVENLABS_API_KEY = prevEleven
    if (prevRef === undefined) delete process.env.TELNYX_ELEVENLABS_API_KEY_REF
    else process.env.TELNYX_ELEVENLABS_API_KEY_REF = prevRef
    if (prevDisabled === undefined) delete process.env.LYNCR_ELEVENLABS_DISABLED
    else process.env.LYNCR_ELEVENLABS_DISABLED = prevDisabled
    resetElevenLabsSpeakCircuitForTests()
  })

  it("maps voice personas to Polly TeXML voices", () => {
    expect(resolveIvrTexmlVoice("en-US-Standard-C")).toBe("Polly.Joanna-Neural")
    expect(resolveIvrTexmlVoice("en-US-Standard-B")).toBe("Polly.Matthew-Neural")
    expect(resolveIvrTexmlVoice("Polly.Joanna-Neural")).toBe("Polly.Joanna-Neural")
  })

  it("maps voice personas to Call Control Speak voices (ElevenLabs + NaturalHD)", () => {
    expect(resolveIvrCallControlVoice("en-US-ElevenLabs-Rachel")).toBe(
      elevenLabsCallControlVoice(ELEVENLABS_VOICE_IDS.rachel)
    )
    expect(resolveIvrCallControlVoice("en-US-ElevenLabs-Bella")).toBe(
      elevenLabsCallControlVoice(ELEVENLABS_VOICE_IDS.bella)
    )
    expect(resolveIvrCallControlVoice("en-US-ElevenLabs-Adam")).toBe(
      elevenLabsCallControlVoice(ELEVENLABS_VOICE_IDS.adam)
    )
    expect(resolveIvrCallControlVoice("en-US-Standard-C")).toBe("Telnyx.NaturalHD.astra")
    expect(resolveIvrCallControlVoice("en-US-NaturalHD-Luna")).toBe("Telnyx.NaturalHD.luna")
    expect(resolveIvrCallControlVoice("en-US-NaturalHD-Albion")).toBe("Telnyx.NaturalHD.albion")
    // Legacy ids still resolve.
    expect(resolveIvrCallControlVoice("en-US-NaturalHD-Abbie")).toBe("Telnyx.NaturalHD.luna")
    expect(resolveIvrCallControlVoice("en-US-NaturalHD-Aiden")).toBe("Telnyx.NaturalHD.albion")
    expect(resolveIvrCallControlVoice("en-US-Standard-B")).toBe("AWS.Polly.Matthew-Neural")
    expect(resolveIvrCallControlVoice("en-US-Standard-E")).toBe("AWS.Polly.Salli-Neural")
    expect(resolveIvrCallControlVoice("en-US-Polly-Joanna")).toBe("AWS.Polly.Joanna-Neural")
    expect(resolveIvrCallControlVoice("en-US-Polly-Ruth")).toBe("AWS.Polly.Ruth-Neural")
    expect(resolveIvrCallControlVoice("en-US-Polly-Stephen")).toBe("AWS.Polly.Stephen-Neural")
    expect(resolveIvrCallControlVoice("Polly.Joanna-Neural")).toBe("AWS.Polly.Joanna-Neural")
  })

  it("normalizes legacy ElevenLabs.Rachel short names to model.voiceId", () => {
    expect(normalizeElevenLabsCallControlVoice("ElevenLabs.Rachel")).toBe(
      elevenLabsCallControlVoice(ELEVENLABS_VOICE_IDS.rachel)
    )
    expect(normalizeElevenLabsCallControlVoice("ElevenLabs.Adam")).toBe(
      elevenLabsCallControlVoice(ELEVENLABS_VOICE_IDS.adam)
    )
  })

  it("falls back ElevenLabs personas to NaturalHD when API key missing", () => {
    delete process.env.ELEVENLABS_API_KEY
    delete process.env.TELNYX_ELEVENLABS_API_KEY_REF
    delete process.env.LYNCR_ELEVENLABS_DISABLED
    expect(resolveSpeakVoiceForPersona("en-US-ElevenLabs-Rachel")).toBe("Telnyx.NaturalHD.astra")
    expect(resolveSpeakVoiceForPersona("en-US-ElevenLabs-Bella")).toBe("Telnyx.NaturalHD.astra")
    expect(resolveSpeakVoiceForPersona("en-US-ElevenLabs-Adam")).toBe("Telnyx.NaturalHD.albion")
  })

  it("keeps ElevenLabs Speak voice when API key present and circuit open not set", () => {
    process.env.ELEVENLABS_API_KEY = "test-key"
    delete process.env.LYNCR_ELEVENLABS_DISABLED
    expect(resolveSpeakVoiceForPersona("en-US-ElevenLabs-Rachel")).toBe(
      elevenLabsCallControlVoice(ELEVENLABS_VOICE_IDS.rachel)
    )
    expect(defaultIvrVoiceEngineModel()).toBe(ELEVENLABS_DEFAULT_IVR_VOICE_ENGINE_MODEL)
  })

  it("forces NaturalHD when LYNCR_ELEVENLABS_DISABLED=1", () => {
    process.env.ELEVENLABS_API_KEY = "test-key"
    process.env.LYNCR_ELEVENLABS_DISABLED = "1"
    expect(resolveSpeakVoiceForPersona("en-US-ElevenLabs-Rachel")).toBe("Telnyx.NaturalHD.astra")
    expect(resolveSpeakVoiceForPersona("en-US-ElevenLabs-Adam")).toBe("Telnyx.NaturalHD.albion")
  })

  it("forces NaturalHD after runtime speak.failed circuit opens", () => {
    process.env.ELEVENLABS_API_KEY = "test-key"
    delete process.env.LYNCR_ELEVENLABS_DISABLED
    markElevenLabsSpeakFailed("test")
    expect(resolveSpeakVoiceForPersona("en-US-ElevenLabs-Rachel")).toBe("Telnyx.NaturalHD.astra")
  })

  it("orders personas with Best labels first (plain English, no vendor names)", () => {
    expect(IVR_VOICE_PERSONA_OPTIONS[0].id).toBe("en-US-ElevenLabs-Rachel")
    expect(IVR_VOICE_PERSONA_OPTIONS[1].id).toBe("en-US-ElevenLabs-Bella")
    expect(IVR_VOICE_PERSONA_OPTIONS[2].id).toBe("en-US-ElevenLabs-Adam")
    expect(IVR_VOICE_PERSONA_OPTIONS[0].callControlVoice).toContain(ELEVENLABS_VOICE_IDS.rachel)
    expect(IVR_VOICE_PERSONA_OPTIONS.map((o) => o.label).join(" ")).toMatch(/★ Best/)
    // Owner-facing labels stay free of engine / vendor jargon.
    const labels = IVR_VOICE_PERSONA_OPTIONS.map((o) => o.label).join(" ")
    expect(labels).not.toMatch(/ElevenLabs|NaturalHD|Polly|Telnyx|Rachel|Bella|Adam/i)
    expect(IVR_VOICE_PERSONA_OPTIONS.map((o) => o.label)).toEqual(
      expect.arrayContaining([
        "★ Best · Calm woman",
        "★ Best · Warm woman",
        "★ Best · Calm man",
        "Calm woman",
      ])
    )
    const descriptions = IVR_VOICE_PERSONA_OPTIONS.map((o) => o.description).join(" ")
    expect(descriptions).not.toMatch(/ElevenLabs|NaturalHD|Polly|Telnyx|ELEVENLABS|Vercel|Integration Secret/i)
  })

  it("normalizes bypass codes and match digits", () => {
    expect(normalizeIvrBypassCode("12-34")).toBe("1234")
    expect(normalizeIvrBypassCode("")).toBe(null)
    expect(digitsMatchIvrBypass("9", "9")).toBe(true)
    expect(digitsMatchIvrBypass("1", "9")).toBe(false)
    expect(resolveAutomationGatherNumDigits("1234")).toBe(4)
    expect(resolveAutomationGatherNumDigits(null)).toBe(1)
  })

  it("detects holiday override windows", () => {
    const now = new Date("2026-12-25T15:00:00.000Z")
    const fields = {
      holidayOverrideStart: "2026-12-24T00:00:00.000Z",
      holidayOverrideEnd: "2026-12-26T23:59:59.000Z",
      holidayGreetingText: "Closed for Christmas. Press 1 to book.",
    }
    expect(isHolidayOverrideActive(fields, now)).toBe(true)
    expect(resolveHolidayGreetingText(fields, now)).toContain("Christmas")
    expect(
      isHolidayOverrideActive(fields, new Date("2026-12-20T12:00:00.000Z"))
    ).toBe(false)
  })

  it("builds Gather with holiday text and persona voice", () => {
    const xml = buildAutomationPresenceGatherXml({
      kind: "holiday",
      actionUrl: "https://lyncr.app/api/telnyx-capture?step=presence-holiday",
      presence: {
        ...DEFAULT_ACCOUNT_PRESENCE,
        ivrBypassCode: "99",
        ivrVoiceEngineModel: "en-US-Standard-B",
        holidayOverrideStart: "2026-01-01T00:00:00.000Z",
        holidayOverrideEnd: "2099-01-01T00:00:00.000Z",
        holidayGreetingText: "Happy New Year from Key Squad.",
      },
      now: new Date("2026-07-01T12:00:00.000Z"),
    })
    expect(xml).toContain("Happy New Year from Key Squad.")
    expect(xml).toContain('voice="Polly.Matthew-Neural"')
    expect(xml).toContain('numDigits="2"')
  })
})
