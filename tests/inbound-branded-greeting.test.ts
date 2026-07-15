import { describe, expect, it, afterEach, vi } from "vitest"
import {
  buildInboundCallerGreetingOnlyTexml,
  buildInstantGenericGreetingFirstPassResult,
  resolveCallerGreetingForDialPass,
  resolveInboundPstnForwardAnswerOnBridge,
  readInboundGreetingFirstPassEnabled,
  isInboundCallerGreetingEnabled,
} from "@/lib/inbound-branded-greeting"
import {
  INBOUND_GREETING_PASS_PARAM,
  buildInboundGreetingContinueUrl,
  inboundGreetingPassDone,
} from "@/lib/inbound-greeting-param"

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
  it("reads lyncrGreet=1 from query params", () => {
    const params = new URLSearchParams(`${INBOUND_GREETING_PASS_PARAM}=1`)
    expect(inboundGreetingPassDone(params)).toBe(true)
  })

  it("still accepts legacy zingGreet from Telnyx POST body fields", () => {
    const params = new URLSearchParams("")
    expect(inboundGreetingPassDone(params, { zingGreet: "1" })).toBe(true)
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
    expect(xml).toContain("Key Squad five oh two")
    expect(xml).toContain("<Redirect")
    expect(xml).toContain(`${INBOUND_GREETING_PASS_PARAM}=1`)
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
    expect(out.xml).toContain(`${INBOUND_GREETING_PASS_PARAM}=1`)
    expect(out.xml).not.toContain("<Dial")
  })
})

describe("isInboundCallerGreetingEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("defaults to true when routing is null", () => {
    vi.stubEnv("ZING_INBOUND_GREETING_FIRST", "1")
    expect(isInboundCallerGreetingEnabled(null)).toBe(true)
  })

  it("respects per-line false", () => {
    vi.stubEnv("ZING_INBOUND_GREETING_FIRST", "1")
    expect(isInboundCallerGreetingEnabled({ inbound_caller_greeting_enabled: false })).toBe(false)
  })
})

describe("resolveCallerGreetingForDialPass", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("plays branded greeting on pass 2 after instant edge redirect", () => {
    vi.stubEnv("ZING_INBOUND_GREETING_FIRST", "1")
    expect(resolveCallerGreetingForDialPass("Key Squad 502", true)).toContain("Key Squad 502")
  })

  it("omits dial greeting on pass 1 (edge redirect only)", () => {
    vi.stubEnv("ZING_INBOUND_GREETING_FIRST", "1")
    expect(resolveCallerGreetingForDialPass("Key Squad 502", false)).toBeUndefined()
  })

  it("includes dial greeting when two-pass mode is disabled", () => {
    vi.stubEnv("ZING_INBOUND_GREETING_FIRST", "0")
    expect(resolveCallerGreetingForDialPass("Key Squad 502", false)).toContain("Key Squad 502")
  })

  it("skips greeting when per-line toggle is off", () => {
    vi.stubEnv("ZING_INBOUND_GREETING_FIRST", "0")
    expect(resolveCallerGreetingForDialPass("Key Squad 502", false, false)).toBeUndefined()
  })
})

describe("resolveInboundPstnForwardAnswerOnBridge", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("disables ringback after pass-1 greeting on pass 2", () => {
    vi.stubEnv("ZING_INBOUND_GREETING_FIRST", "1")
    expect(resolveInboundPstnForwardAnswerOnBridge(true, true)).toBe(false)
    expect(resolveInboundPstnForwardAnswerOnBridge(false, true)).toBe(true)
  })

  it("follows env when two-pass greeting is disabled", () => {
    vi.stubEnv("ZING_INBOUND_GREETING_FIRST", "0")
    expect(resolveInboundPstnForwardAnswerOnBridge(false)).toBe(true)
  })

  it("uses ringback when per-line greeting is disabled", () => {
    vi.stubEnv("ZING_INBOUND_GREETING_FIRST", "1")
    expect(resolveInboundPstnForwardAnswerOnBridge(false, false)).toBe(true)
  })
})
