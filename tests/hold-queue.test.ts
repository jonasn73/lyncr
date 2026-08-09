import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import {
  lyncrHoldQueueName,
  holdMaxWaitSecs,
  holdMaxConcurrent,
  HOLD_AWARE_BUSY_PROMPT,
} from "@/lib/hold-queue"
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

  it("soft Busy default mentions stay on the line", () => {
    expect(HOLD_AWARE_BUSY_PROMPT.toLowerCase()).toContain("stay on the line")
    expect(HOLD_AWARE_BUSY_PROMPT.toLowerCase()).toContain("press 1")
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
})

describe("envLyncrOrZing", () => {
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
