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

  it("intercepts first POST to telnyx incoming", () => {
    vi.stubEnv("ZING_INBOUND_GREETING_FIRST", "1")
    const url = new URL("https://lyncr.app/api/voice/telnyx/incoming")
    expect(shouldEdgeInstantGreetingIntercept(url.pathname, url, "POST")).toBe(true)
  })

  it("passes through when zingGreet=1", () => {
    vi.stubEnv("ZING_INBOUND_GREETING_FIRST", "1")
    const url = new URL("https://lyncr.app/api/voice/telnyx/incoming?zingGreet=1")
    expect(shouldEdgeInstantGreetingIntercept(url.pathname, url, "POST")).toBe(false)
  })
})

describe("buildEdgeInstantGreetingTexml", () => {
  it("returns Play then Redirect without Dial (faster than TTS Say)", () => {
    const requestUrl = "https://lyncr.app/api/voice/telnyx/greet"
    const continueUrl = buildEdgeInboundGreetingContinueUrl(requestUrl)
    const xml = buildEdgeInstantGreetingTexml(continueUrl, requestUrl)
    expect(xml).toContain("<Play>")
    expect(xml).toContain("/audio/inbound-generic-greeting.wav")
    expect(xml).toContain("<Redirect")
    expect(continueUrl).toContain("/api/voice/telnyx/incoming")
    expect(continueUrl).toContain("zingGreet=1")
    expect(edgeInboundGreetingPassDone(new URL(continueUrl))).toBe(true)
    expect(xml).not.toContain("<Dial")
    expect(xml).not.toContain("<Say")
  })
})
