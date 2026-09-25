import { describe, expect, it, afterEach, vi } from "vitest"
import {
  buildFastReceptionistDialTexml,
  buildRoutingPoolDialTexml,
  buildInboundDialRingbackAttributes,
  buildHoldFallbackAmdDetectionConfig,
  resolveAmdMinMachineAgeForRingSec,
  resolveAmdMinMachineAgeMs,
  resolveInboundFastDialTimeoutSeconds,
  resolveInboundForwardDialTimeoutSeconds,
} from "@/lib/telnyx-inbound-media-quality"
import { resolveInboundPstnForwardAnswerOnBridge } from "@/lib/inbound-branded-greeting"

describe("resolveInboundPstnForwardAnswerOnBridge (cell PSTN forward)", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("keeps answerOnBridge after greeting pass but omits ringTone when ringback is off", () => {
    vi.stubEnv("LYNCR_INBOUND_GREETING_FIRST", "1")
    const xml = buildFastReceptionistDialTexml({
      answerOnBridge: resolveInboundPstnForwardAnswerOnBridge(true),
      timeout: 30,
      action: "https://lyncr.app/api/voice/telnyx/fallback/u/x",
      receptionistE164: "+15551234567",
      includeRingback: false,
    })
    expect(xml).toContain('answerOnBridge="true"')
    expect(xml).not.toContain("ringTone")
  })
})

describe("resolveInboundFastDialTimeoutSeconds", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("uses routing snapshot when env is unset", () => {
    vi.stubEnv("LYNCR_INBOUND_FAST_DIAL_TIMEOUT", "")
    expect(resolveInboundFastDialTimeoutSeconds(30)).toBe(30)
  })

  it("honors LYNCR_INBOUND_FAST_DIAL_TIMEOUT=20", () => {
    vi.stubEnv("LYNCR_INBOUND_FAST_DIAL_TIMEOUT", "20")
    expect(resolveInboundFastDialTimeoutSeconds(30)).toBe(20)
  })
})

describe("resolveInboundForwardDialTimeoutSeconds", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("caps at 20s when AI fallback is enabled", () => {
    vi.stubEnv("LYNCR_INBOUND_AI_DIAL_TIMEOUT", "20")
    expect(resolveInboundForwardDialTimeoutSeconds(30, true)).toBe(20)
  })

  it("uses full routing timeout when AI fallback is off", () => {
    expect(resolveInboundForwardDialTimeoutSeconds(30, false)).toBe(30)
  })

  it("caps at 15s when Hold queue fallback is enabled", () => {
    vi.stubEnv("LYNCR_INBOUND_HOLD_DIAL_TIMEOUT", "25")
    expect(resolveInboundForwardDialTimeoutSeconds(30, false, true)).toBe(15)
  })

  it("keeps shorter ring when Hold cap is higher than routing timeout", () => {
    vi.stubEnv("LYNCR_INBOUND_HOLD_DIAL_TIMEOUT", "25")
    expect(resolveInboundForwardDialTimeoutSeconds(15, false, true)).toBe(15)
  })

  it("defaults Hold cap to 15s when env unset", () => {
    vi.stubEnv("LYNCR_INBOUND_HOLD_DIAL_TIMEOUT", "")
    expect(resolveInboundForwardDialTimeoutSeconds(30, false, true)).toBe(15)
  })

  it("caps a longer saved timeout to 15s", () => {
    vi.stubEnv("LYNCR_INBOUND_HOLD_DIAL_TIMEOUT", "")
    expect(resolveInboundForwardDialTimeoutSeconds(20, false, true)).toBe(15)
  })
})

describe("AMD early-machine helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("defaults min machine age to 18s (full Hold ring window)", () => {
    vi.stubEnv("LYNCR_INBOUND_AMD_MIN_MACHINE_AGE_MS", "")
    vi.stubEnv("LYNCR_INBOUND_AMD_MIN_MACHINE_AGE_MS", "")
    expect(resolveAmdMinMachineAgeMs()).toBe(18_000)
  })

  it("honors LYNCR_INBOUND_AMD_MIN_MACHINE_AGE_MS override", () => {
    vi.stubEnv("LYNCR_INBOUND_AMD_MIN_MACHINE_AGE_MS", "15000")
    expect(resolveAmdMinMachineAgeMs()).toBe(15_000)
  })

  it("trusts machine at the floor age on a normal-length ring, not just the last 3s", () => {
    vi.stubEnv("LYNCR_INBOUND_AMD_MIN_MACHINE_AGE_MS", "12000")
    // 20s and 25s rings both comfortably exceed the 12s floor + 3s safety margin, so the
    // floor itself is the trust age — a real carrier voicemail pickup around 15-20s must be
    // trusted well before the ring ends, not waved through as an "early false positive"
    // just because it landed outside the final 3 seconds.
    expect(resolveAmdMinMachineAgeForRingSec(20)).toBe(12_000)
    expect(resolveAmdMinMachineAgeForRingSec(25)).toBe(12_000)
  })

  it("caps trust age down for a short ring so 3s remain to redirect before it naturally times out", () => {
    vi.stubEnv("LYNCR_INBOUND_AMD_MIN_MACHINE_AGE_MS", "18000")
    // 15s ring can't wait for an 18s floor — clamp to ring − 3s instead.
    expect(resolveAmdMinMachineAgeForRingSec(15)).toBe(12_000)
  })

  it("builds conservative classic AMD config, capped so the caller isn't left on ringback too long", () => {
    const cfg = buildHoldFallbackAmdDetectionConfig()
    expect(cfg.initial_silence_millis).toBe(5_000)
    expect(cfg.total_analysis_time_millis).toBe(5_000)
  })
})

describe("buildInboundDialRingbackAttributes", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("defaults to native US ringTone", () => {
    vi.stubEnv("LYNCR_INBOUND_DIAL_RINGBACK_AUDIO_URL", "")
    expect(buildInboundDialRingbackAttributes()).toEqual({ ringTone: "us" })
  })

  it("uses audioUrl when LYNCR_INBOUND_DIAL_RINGBACK_AUDIO_URL is set", () => {
    vi.stubEnv(
      "LYNCR_INBOUND_DIAL_RINGBACK_AUDIO_URL",
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
    expect(xml).toContain("Key Squad five oh two")
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
