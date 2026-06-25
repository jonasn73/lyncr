import { describe, expect, it } from "vitest"
import {
  buildReceptionistPress1AcceptedTexml,
  buildReceptionistPress1ScreenTexml,
} from "@/lib/receptionist-screen-texml"
import {
  buildFastReceptionistDialTexml,
  buildInboundPstnNumberAttributesWithAnswerUrl,
} from "@/lib/telnyx-inbound-media-quality"
import { shouldPlayCallerRingbackDuringDial } from "@/lib/inbound-branded-greeting"

describe("buildInboundPstnNumberAttributesWithAnswerUrl", () => {
  it("sets url and method POST for the press-1 screen webhook", () => {
    const attrs = buildInboundPstnNumberAttributesWithAnswerUrl(
      "https://lyncr.app/api/voice/telnyx/receptionist-answer?r=abc"
    )
    expect(attrs.url).toContain("receptionist-answer")
    expect(attrs.method).toBe("POST")
  })
})

describe("buildFastReceptionistDialTexml ringback", () => {
  it("omits ringTone when includeRingback is false", () => {
    const xml = buildFastReceptionistDialTexml({
      answerOnBridge: true,
      timeout: 20,
      action: "https://lyncr.app/api/voice/telnyx/fallback/u/u1",
      receptionistE164: "+15022802716",
      includeRingback: false,
    })
    expect(xml).toContain('answerOnBridge="true"')
    expect(xml).not.toContain('ringTone="us"')
  })

  it("includes method POST on Number when answerUrl is set", () => {
    const xml = buildFastReceptionistDialTexml({
      answerOnBridge: true,
      timeout: 20,
      action: "https://lyncr.app/api/voice/telnyx/fallback/u/u1",
      receptionistE164: "+15022802716",
      answerUrl: "https://lyncr.app/api/voice/telnyx/receptionist-answer?r=1",
    })
    expect(xml).toContain('method="POST"')
    expect(xml).toContain("receptionist-answer")
  })
})

describe("shouldPlayCallerRingbackDuringDial", () => {
  it("suppresses ringback after greeting pass by default", () => {
    expect(shouldPlayCallerRingbackDuringDial(true)).toBe(false)
  })
})

describe("buildReceptionistPress1ScreenTexml", () => {
  it("requires digit 1 and mentions Press 1", () => {
    const xml = buildReceptionistPress1ScreenTexml(
      "Key Squad 502",
      "https://lyncr.app/api/voice/telnyx/receptionist-answer?g=1"
    )
    expect(xml).toContain('validDigits="1"')
    expect(xml).toContain("Press 1 to connect")
    expect(xml).toContain("Key Squad 502")
  })

  it("returns empty response when press 1 accepted", () => {
    expect(buildReceptionistPress1AcceptedTexml()).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
    )
  })
})
