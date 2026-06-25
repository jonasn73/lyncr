import { describe, expect, it, afterEach, vi } from "vitest"
import {
  buildInboundCallerGreetingOnlyTexml,
  buildInboundGreetingContinueUrl,
  buildInstantGenericGreetingFirstPassResult,
  inboundGreetingPassDone,
  readInboundGreetingFirstPassEnabled,
  resolveCallerGreetingForDialPass,
  resolveInboundPstnForwardAnswerOnBridge,
} from "@/lib/inbound-branded-greeting"

describe("readInboundGreetingFirstPassEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("is on by default", () => {
    vi.stubEnv("ZING_INBOUND_GREETING_FIRST", "")
    expect(readInboundGreetingFirstPassEnabled()).toBe(true)
  })

  it("can be disabled with ZING_INBOUND_GREETING_FIRST=0", () => {
    vi.stubEnv("ZING_INBOUND_GREETING_FIRST", "0")
    expect(readInboundGreetingFirstPassEnabled()).toBe(false)
  })
})

describe("inboundGreetingPassDone", () => {
  it("reads zingGreet=1 from query params", () => {
    const params = new URLSearchParams("zingGreet=1")
    expect(inboundGreetingPassDone(params)).toBe(true)
  })
})

describe("buildInboundCallerGreetingOnlyTexml", () => {
  it("plays Say before Redirect with no Dial", () => {
    const continueUrl = buildInboundGreetingContinueUrl("https://lyncr.app/api/voice/telnyx/incoming")
    const xml = buildInboundCallerGreetingOnlyTexml(
      "Thank you for calling Key Squad 502. Please wait while we connect your call to a team member.",
      continueUrl
    )
    expect(xml).toContain("<Say ")
    expect(xml).toContain("Key Squad 502")
    expect(xml).toContain("<Redirect")
    expect(xml).toContain("zingGreet=1")
    expect(xml).not.toContain("<Dial")
    expect(xml.indexOf("<Say")).toBeLessThan(xml.indexOf("<Redirect"))
  })
})

describe("buildInstantGenericGreetingFirstPassResult", () => {
  it("returns Say and Redirect without Dial and uses prebuilt generic copy", () => {
    const continueUrl = buildInboundGreetingContinueUrl("https://lyncr.app/api/voice/telnyx/incoming")
    const out = buildInstantGenericGreetingFirstPassResult(continueUrl)
    expect(out.xml).toContain("<Say ")
    expect(out.xml).toContain("Thank you for calling.")
    expect(out.xml).toContain("<Redirect")
    expect(out.xml).toContain("zingGreet=1")
    expect(out.xml).not.toContain("<Dial")
  })
})

describe("resolveCallerGreetingForDialPass", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("omits dial greeting when two-pass mode is enabled", () => {
    vi.stubEnv("ZING_INBOUND_GREETING_FIRST", "1")
    expect(resolveCallerGreetingForDialPass("Key Squad 502", false)).toBeUndefined()
  })

  it("includes dial greeting when two-pass mode is disabled", () => {
    vi.stubEnv("ZING_INBOUND_GREETING_FIRST", "0")
    expect(resolveCallerGreetingForDialPass("Key Squad 502", false)).toContain("Key Squad 502")
  })
})

describe("resolveInboundPstnForwardAnswerOnBridge", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("is false after greeting pass so cell forward does not restore caller ringback", () => {
    vi.stubEnv("ZING_INBOUND_GREETING_FIRST", "1")
    expect(resolveInboundPstnForwardAnswerOnBridge(true)).toBe(false)
  })

  it("stays true on pass 1 when two-pass greeting is disabled", () => {
    vi.stubEnv("ZING_INBOUND_GREETING_FIRST", "0")
    expect(resolveInboundPstnForwardAnswerOnBridge(false)).toBe(true)
  })
})
