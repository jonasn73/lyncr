import { describe, expect, it, afterEach, vi } from "vitest"
import {
  buildEdgeInstantGreetingTexml,
  buildEdgeInboundGreetingContinueUrl,
  edgeInboundGreetingPassDone,
  shouldEdgeInstantGreetingIntercept,
} from "@/lib/inbound-instant-greet-edge"

describe("shouldEdgeInstantGreetingIntercept", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("intercepts pass-1 /incoming before Node cold start", () => {
    vi.stubEnv("LYNCR_INBOUND_GREETING_FIRST", "1")
    const url = new URL("https://lyncr.app/api/voice/telnyx/incoming")
    expect(shouldEdgeInstantGreetingIntercept(url.pathname, url, "POST")).toBe(true)
  })

  it("passes through when lyncrGreet=1 (pass 2 routing)", () => {
    vi.stubEnv("LYNCR_INBOUND_GREETING_FIRST", "1")
    const url = new URL("https://lyncr.app/api/voice/telnyx/incoming?lyncrGreet=1")
    expect(shouldEdgeInstantGreetingIntercept(url.pathname, url, "POST")).toBe(false)
  })
})

describe("buildEdgeInstantGreetingTexml", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("returns instant Redirect only (no Say — branded greeting plays on pass 2)", () => {
    const continueUrl = buildEdgeInboundGreetingContinueUrl("https://lyncr.app/api/voice/telnyx/greet")
    const xml = buildEdgeInstantGreetingTexml(continueUrl)
    expect(xml).toContain("<Redirect")
    expect(continueUrl).toContain("/api/voice/telnyx/incoming")
    expect(continueUrl).toContain("lyncrGreet=1")
    expect(edgeInboundGreetingPassDone(new URL(continueUrl))).toBe(true)
    expect(xml).not.toContain("<Dial")
    expect(xml).not.toContain("<Say")
    expect(xml).not.toContain("<Play")
  })
})
