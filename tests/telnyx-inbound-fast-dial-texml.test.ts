import { describe, expect, it, afterEach, vi } from "vitest"
import {
  buildFastReceptionistDialTexml,
  readInboundFastDialAnswerOnBridge,
  resolveInboundFastDialTimeoutSeconds,
} from "@/lib/telnyx-inbound-media-quality"

describe("readInboundFastDialAnswerOnBridge", () => {
  it("is always true on the fast inbound path", () => {
    expect(readInboundFastDialAnswerOnBridge()).toBe(true)
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
})
