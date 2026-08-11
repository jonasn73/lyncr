import { describe, expect, it, afterEach, vi } from "vitest"
import {
  buildFastReceptionistDialTexml,
  buildRoutingPoolDialTexml,
  buildInboundDialRingbackAttributes,
  buildHoldFallbackAmdDetectionConfig,
  resolveAmdMinMachineAgeMs,
  resolveInboundFastDialTimeoutSeconds,
  resolveInboundForwardDialTimeoutSeconds,
} from "@/lib/telnyx-inbound-media-quality"
import { resolveInboundPstnForwardAnswerOnBridge } from "@/lib/inbound-branded-greeting"

describe("resolveInboundPstnForwardAnswerOnBridge (cell PSTN forward)", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("builds cell `<Number>` dial without answerOnBridge after greeting pass", () => {
    vi.stubEnv("ZING_INBOUND_GREETING_FIRST", "1")
    const xml = buildFastReceptionistDialTexml({
      answerOnBridge: resolveInboundPstnForwardAnswerOnBridge(true),
      timeout: 30,
      action: "https://lyncr.app/api/voice/telnyx/fallback/u/x",
      receptionistE164: "+15551234567",
      includeRingback: false,
    })
    expect(xml).not.toContain("answerOnBridge")
    expect(xml).not.toContain("ringTone")
  })
})

describe("resolveInboundFastDialTimeoutSeconds", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("uses routing snapshot when env is unset", () => {
    vi.stubEnv("ZING_INBOUND_FAST_DIAL_TIMEOUT", "")
    expect(resolveInboundFastDialTimeoutSeconds(30)).toBe(30)
  })

  it("honors ZING_INBOUND_FAST_DIAL_TIMEOUT=20", () => {
    vi.stubEnv("ZING_INBOUND_FAST_DIAL_TIMEOUT", "20")
    expect(resolveInboundFastDialTimeoutSeconds(30)).toBe(20)
  })
})

describe("resolveInboundForwardDialTimeoutSeconds", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("caps at 20s when AI fallback is enabled", () => {
    vi.stubEnv("ZING_INBOUND_AI_DIAL_TIMEOUT", "20")
    expect(resolveInboundForwardDialTimeoutSeconds(30, true)).toBe(20)
  })

  it("uses full routing timeout when AI fallback is off", () => {
    expect(resolveInboundForwardDialTimeoutSeconds(30, false)).toBe(30)
  })

  it("caps at 25s when Hold queue fallback is enabled", () => {
    vi.stubEnv("ZING_INBOUND_HOLD_DIAL_TIMEOUT", "25")
    expect(resolveInboundForwardDialTimeoutSeconds(30, false, true)).toBe(25)
  })

  it("keeps shorter ring when Hold cap is higher than routing timeout", () => {
    vi.stubEnv("ZING_INBOUND_HOLD_DIAL_TIMEOUT", "25")
    expect(resolveInboundForwardDialTimeoutSeconds(15, false, true)).toBe(15)
  })

  it("defaults Hold cap to 25s when env unset", () => {
    vi.stubEnv("ZING_INBOUND_HOLD_DIAL_TIMEOUT", "")
    expect(resolveInboundForwardDialTimeoutSeconds(30, false, true)).toBe(25)
  })

  it("honors UI 20s under the Hold cap", () => {
    vi.stubEnv("ZING_INBOUND_HOLD_DIAL_TIMEOUT", "")
    expect(resolveInboundForwardDialTimeoutSeconds(20, false, true)).toBe(20)
  })
})

describe("AMD early-machine helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("defaults min machine age to 12s", () => {
    vi.stubEnv("ZING_INBOUND_AMD_MIN_MACHINE_AGE_MS", "")
    expect(resolveAmdMinMachineAgeMs()).toBe(12_000)
  })

  it("builds conservative classic AMD config", () => {
    expect(buildHoldFallbackAmdDetectionConfig().initial_silence_millis).toBe(15_000)
  })
})

describe("buildInboundDialRingbackAttributes", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("defaults to native US ringTone", () => {
    vi.stubEnv("ZING_INBOUND_DIAL_RINGBACK_AUDIO_URL", "")
    expect(buildInboundDialRingbackAttributes()).toEqual({ ringTone: "us" })
  })

  it("uses audioUrl when ZING_INBOUND_DIAL_RINGBACK_AUDIO_URL is set", () => {
    vi.stubEnv(
      "ZING_INBOUND_DIAL_RINGBACK_AUDIO_URL",
      "https://lyncr.app/audio/us-ringback.wav"
    )
    expect(buildInboundDialRingbackAttributes()).toEqual({
      audioUrl: "https://lyncr.app/audio/us-ringback.wav",
    })
  })
})

describe("buildFastReceptionistDialTexml", () => {
  it("emits answerOnBridge, ringTone, timeout, and simultaneous dial attrs", () => {
    const xml = buildFastReceptionistDialTexml({
      callerId: "+15026638961",
      answerOnBridge: true,
      timeout: 20,
      action: "https://lyncr.app/api/voice/telnyx/fallback/u/u1",
      receptionistE164: "+15022802716",
    })
    expect(xml).toContain('answerOnBridge="true"')
    expect(xml).toContain('ringTone="us"')
    expect(xml).toContain('timeout="20"')
    expect(xml).not.toContain('sequential="true"')
    expect(xml).toContain("+15022802716")
  })

  it("prepends branded caller greeting on pass 2 after edge redirect", () => {
    const xml = buildFastReceptionistDialTexml({
      answerOnBridge: resolveInboundPstnForwardAnswerOnBridge(true),
      timeout: 20,
      action: "https://lyncr.app/api/voice/telnyx/fallback/u/u1",
      receptionistE164: "+15022802716",
      callerGreeting: "Thank you for calling Key Squad 502. Please wait while we connect your call to a team member.",
      includeRingback: false,
    })
    expect(xml).toContain("<Say ")
    expect(xml).toContain("Key Squad 502")
    expect(xml.indexOf("<Say")).toBeLessThan(xml.indexOf("<Dial"))
    expect(xml).not.toContain("ringTone")
  })
})

describe("buildRoutingPoolDialTexml", () => {
  it("rings multiple receptionists simultaneously", () => {
    const xml = buildRoutingPoolDialTexml({
      answerOnBridge: true,
      timeout: 25,
      action: "https://lyncr.app/api/voice/telnyx/fallback/u/u1?pool=1",
      receptionistE164List: ["+15021111111", "+15022222222"],
      mode: "simultaneous",
    })
    expect(xml).toContain("+15021111111")
    expect(xml).toContain("+15022222222")
    expect(xml).not.toContain('sequential="true"')
  })

  it("sets sequential when pool mode is sequential", () => {
    const xml = buildRoutingPoolDialTexml({
      answerOnBridge: true,
      timeout: 25,
      action: "https://lyncr.app/api/voice/telnyx/fallback/u/u1?pool=1",
      receptionistE164List: ["+15021111111", "+15022222222"],
      mode: "sequential",
    })
    expect(xml).toContain('sequential="true"')
  })
})
