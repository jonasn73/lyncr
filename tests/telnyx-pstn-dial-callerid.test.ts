import { describe, expect, it, afterEach, vi } from "vitest"
import {
  origFromQuerySuffix,
  readTelnyxDialAnswerOnBridge,
  resolveExternalCallerE164ForDialChain,
  resolvePstnDialCallerIdForInboundForward,
} from "@/lib/telnyx-pstn-dial-callerid"

describe("resolvePstnDialCallerIdForInboundForward", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("uses business line by default (forwardOriginalCallerId off)", () => {
    vi.stubEnv("ZING_INBOUND_DIAL_CALLER_ID_USE_BUSINESS_LINE", "")
    expect(
      resolvePstnDialCallerIdForInboundForward({
        inboundFromRaw: "+15551234567",
        businessOutboundE164: "+15025199741",
      })
    ).toBe("+15025199741")
  })

  it("uses customer number when forwardOriginalCallerId is true", () => {
    vi.stubEnv("ZING_INBOUND_DIAL_CALLER_ID_USE_BUSINESS_LINE", "")
    expect(
      resolvePstnDialCallerIdForInboundForward({
        inboundFromRaw: "+15551234567",
        businessOutboundE164: "+15025199741",
        forwardOriginalCallerId: true,
      })
    ).toBe("+15551234567")
  })

  it("forces business line when env is set even if toggle is on", () => {
    vi.stubEnv("ZING_INBOUND_DIAL_CALLER_ID_USE_BUSINESS_LINE", "1")
    expect(
      resolvePstnDialCallerIdForInboundForward({
        inboundFromRaw: "+15551234567",
        businessOutboundE164: "+15025199741",
        forwardOriginalCallerId: true,
      })
    ).toBe("+15025199741")
  })

  it("falls back to business line when caller is empty", () => {
    vi.stubEnv("ZING_INBOUND_DIAL_CALLER_ID_USE_BUSINESS_LINE", "")
    expect(
      resolvePstnDialCallerIdForInboundForward({
        inboundFromRaw: "",
        businessOutboundE164: "+15025199908",
        forwardOriginalCallerId: true,
      })
    ).toBe("+15025199908")
  })
})

describe("resolveExternalCallerE164ForDialChain", () => {
  it("prefers origFrom param over form From", () => {
    expect(
      resolveExternalCallerE164ForDialChain({
        origFromParam: "+16125550100",
        formFromDial: "+15025199741",
      })
    ).toBe("+16125550100")
  })
})

describe("readTelnyxDialAnswerOnBridge", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("is true when env is unset (sync ringback with B-leg)", () => {
    vi.stubEnv("ZING_INBOUND_DIAL_ANSWER_ON_BRIDGE", "")
    expect(readTelnyxDialAnswerOnBridge()).toBe(true)
  })

  it("is true when env is 1", () => {
    vi.stubEnv("ZING_INBOUND_DIAL_ANSWER_ON_BRIDGE", "1")
    expect(readTelnyxDialAnswerOnBridge()).toBe(true)
  })
})

describe("origFromQuerySuffix", () => {
  it("builds query fragment from URL param", () => {
    const url = new URL("https://example.com/fallback?origFrom=%2B16125550199")
    const fd = new FormData()
    expect(origFromQuerySuffix(url, fd, "Unknown")).toBe("&origFrom=%2B16125550199")
  })
})
