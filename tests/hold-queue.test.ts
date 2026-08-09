import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import {
  lyncrHoldQueueName,
  holdMaxWaitSecs,
  holdMaxConcurrent,
  HOLD_AWARE_BUSY_PROMPT,
  HOLD_REPROMPT_DEFAULT,
  resolveHoldMusicUrl,
} from "@/lib/hold-queue"
import {
  HOLD_MUSIC_PRESETS,
  holdMusicValueForPreset,
  matchHoldMusicPreset,
} from "@/lib/hold-music-presets"
import { envLyncrOrZing, envFlagOn } from "@/lib/lyncr-env"
import {
  encodeTelnyxCallControlState,
  decodeTelnyxCallControlState,
} from "@/lib/telnyx-call-control-state"

describe("hold-queue helpers", () => {
  it("builds lyncr-{userId} queue names", () => {
    expect(lyncrHoldQueueName("abc-123")).toBe("lyncr-abc-123")
  })

  it("clamps max wait and concurrent caps", () => {
    expect(holdMaxWaitSecs()).toBeGreaterThanOrEqual(120)
    expect(holdMaxWaitSecs()).toBeLessThanOrEqual(900)
    expect(holdMaxConcurrent()).toBeGreaterThanOrEqual(1)
    expect(holdMaxConcurrent()).toBeLessThanOrEqual(10)
  })

  it("soft Busy default mentions stay on the line and short form text", () => {
    expect(HOLD_AWARE_BUSY_PROMPT.toLowerCase()).toContain("stay on the line")
    expect(HOLD_AWARE_BUSY_PROMPT.toLowerCase()).toContain("press 1")
    expect(HOLD_AWARE_BUSY_PROMPT.toLowerCase()).toContain("short form")
  })

  it("re-prompt says still in line", () => {
    expect(HOLD_REPROMPT_DEFAULT.toLowerCase()).toContain("still in line")
  })

  it("round-trips hold loop client_state", () => {
    const raw = encodeTelnyxCallControlState({
      v: 1,
      phase: "await_busy_hold_loop",
      userId: "u1",
      businessLineE164: "+15555571219",
      callerE164: "+15551234567",
      holdQueueName: "lyncr-u1",
      holdStartedAtMs: 1_700_000_000_000,
      holdSegment: "music",
      holdPromptCount: 2,
    })
    const decoded = decodeTelnyxCallControlState(raw)
    expect(decoded?.phase).toBe("await_busy_hold_loop")
    expect(decoded?.holdSegment).toBe("music")
    expect(decoded?.holdQueueName).toBe("lyncr-u1")
  })

  it("maps hold music presets to /audio paths", () => {
    expect(HOLD_MUSIC_PRESETS.length).toBeGreaterThanOrEqual(3)
    expect(holdMusicValueForPreset("calm")).toBe("/audio/hold-calm.mp3")
    expect(matchHoldMusicPreset("/audio/hold-upbeat.mp3")).toBe("upbeat")
    expect(matchHoldMusicPreset("/audio/hold-upbeat.wav")).toBe("upbeat")
    expect(matchHoldMusicPreset("")).toBe("default")
    expect(matchHoldMusicPreset("https://cdn.example/custom.mp3")).toBe("custom")
  })

  it("resolves relative preset paths against app URL when set", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://lyncr.app")
    expect(resolveHoldMusicUrl("/audio/hold-calm.mp3")).toBe(
      "https://lyncr.app/audio/hold-calm.mp3"
    )
    expect(resolveHoldMusicUrl(null)).toBe("https://lyncr.app/audio/hold-calm.mp3")
  })
})

describe("envLyncrOrZing", () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("prefers LYNCR_ over ZING_", () => {
    vi.stubEnv("LYNCR_HOLD_MUSIC_URL", "https://lyncr.example/a.mp3")
    vi.stubEnv("ZING_HOLD_MUSIC_URL", "https://zing.example/b.mp3")
    expect(envLyncrOrZing("HOLD_MUSIC_URL")).toBe("https://lyncr.example/a.mp3")
  })

  it("falls back to ZING_ when LYNCR_ unset", () => {
    vi.stubEnv("ZING_INBOUND_CALL_CONTROL", "1")
    expect(envLyncrOrZing("INBOUND_CALL_CONTROL")).toBe("1")
    expect(envFlagOn("INBOUND_CALL_CONTROL")).toBe(true)
  })
})
