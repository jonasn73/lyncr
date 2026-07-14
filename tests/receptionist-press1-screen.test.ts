import { describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { GET as receptionistAnswerGet } from "@/app/api/voice/telnyx/receptionist-answer/route"
import {
  buildReceptionistPress1AcceptedTexml,
  buildReceptionistPress1ScreenTexml,
} from "@/lib/receptionist-screen-texml"
import {
  buildFastReceptionistDialTexml,
  buildInboundPstnNumberAttributesWithAnswerUrl,
} from "@/lib/telnyx-inbound-media-quality"
import { shouldPlayCallerRingbackDuringDial } from "@/lib/inbound-branded-greeting"

describe("receptionist-answer route", () => {
  it("owner leg (no r=) still requires press-1 to accept (anti-voicemail)", async () => {
    const req = new NextRequest(
      "https://lyncr.app/api/voice/telnyx/receptionist-answer?cl=CA_test&bt=generic&bn=Key%20Squad"
    )
    const res = await receptionistAnswerGet(req)
    const xml = await res.text()
    expect(xml).toContain("<Gather")
    expect(xml).toContain("Press 1 to accept this call")
  })

  it("receptionist leg still shows press-1 gather", async () => {
    const req = new NextRequest(
      "https://lyncr.app/api/voice/telnyx/receptionist-answer?r=recv-1&cl=CA_test&bt=generic&bn=Key%20Squad"
    )
    const res = await receptionistAnswerGet(req)
    const xml = await res.text()
    expect(xml).toContain("<Gather")
    expect(xml).toContain("Press 1 to accept this call")
  })
})

describe("buildInboundPstnNumberAttributesWithAnswerUrl", () => {
  it("sets url, method POST, and dial-leg status callbacks", () => {
    const attrs = buildInboundPstnNumberAttributesWithAnswerUrl(
      "https://lyncr.app/api/voice/telnyx/receptionist-answer?r=abc"
    )
    expect(attrs.url).toContain("receptionist-answer")
    expect(attrs.method).toBe("POST")
    expect(attrs.statusCallback).toContain("/api/voice/telnyx/status")
    expect(String(attrs.statusCallbackEvent)).toContain("initiated")
    expect(String(attrs.statusCallbackEvent)).toContain("answered")
    expect(String(attrs.statusCallbackEvent)).toContain("completed")
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
  it("never ringbacks in two-pass mode (cell PSTN forward)", () => {
    expect(shouldPlayCallerRingbackDuringDial(true)).toBe(false)
    expect(shouldPlayCallerRingbackDuringDial(false)).toBe(false)
  })
})

describe("buildReceptionistPress1ScreenTexml", () => {
  it("requires digit 1 and mentions Press 1", () => {
    const xml = buildReceptionistPress1ScreenTexml(
      "Key Squad 502",
      "https://lyncr.app/api/voice/telnyx/receptionist-answer?g=1"
    )
    expect(xml).toContain('validDigits="1"')
    expect(xml).toContain('timeout="5"')
    expect(xml).toContain("Press 1 to accept this call")
    expect(xml).toContain("Key Squad 502")
  })

  it("returns empty response when press 1 accepted", () => {
    expect(buildReceptionistPress1AcceptedTexml()).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
    )
  })
})
