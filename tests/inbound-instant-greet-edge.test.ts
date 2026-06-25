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

  it("is disabled so per-line greeting is decided in /incoming", () => {
    vi.stubEnv("ZING_INBOUND_GREETING_FIRST", "1")
    const url = new URL("https://lyncr.app/api/voice/telnyx/incoming")
    expect(shouldEdgeInstantGreetingIntercept(url.pathname, url, "POST")).toBe(false)
  })

  it("passes through when lyncrGreet=1", () => {
    vi.stubEnv("ZING_INBOUND_GREETING_FIRST", "1")
    const url = new URL("https://lyncr.app/api/voice/telnyx/incoming?lyncrGreet=1")
    expect(shouldEdgeInstantGreetingIntercept(url.pathname, url, "POST")).toBe(false)
  })
})

describe("buildEdgeInstantGreetingTexml", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("returns Say then Redirect without Dial (Telnyx answers locally — no Play fetch delay)", () => {
    const continueUrl = buildEdgeInboundGreetingContinueUrl("https://lyncr.app/api/voice/telnyx/greet")
    const xml = buildEdgeInstantGreetingTexml(continueUrl)
    expect(xml).toContain("<Say ")
    expect(xml).toContain("Polly.Joanna")
    expect(xml).toContain("Thank you for calling.")
    expect(xml).toContain("<Redirect")
    expect(continueUrl).toContain("/api/voice/telnyx/incoming")
    expect(continueUrl).toContain("lyncrGreet=1")
    expect(edgeInboundGreetingPassDone(new URL(continueUrl))).toBe(true)
    expect(xml).not.toContain("<Dial")
    expect(xml).not.toContain("<Play")
  })

  it("uses Play only when ZING_INBOUND_INSTANT_GREETING_AUDIO_URL is set", () => {
    vi.stubEnv("ZING_INBOUND_INSTANT_GREETING_AUDIO_URL", "https://cdn.example.com/greet.mp3")
    const continueUrl = buildEdgeInboundGreetingContinueUrl("https://lyncr.app/api/voice/telnyx/greet")
    const xml = buildEdgeInstantGreetingTexml(continueUrl)
    expect(xml).toContain("<Play>")
    expect(xml).toContain("https://cdn.example.com/greet.mp3")
    expect(xml).not.toContain("<Say")
  })
})
