import { describe, expect, it } from "vitest"
import { VoiceResponse } from "@/lib/texml"

describe("Telnyx TeXML VoiceResponse", () => {
  it("builds Say + Hangup without Twilio", () => {
    const vr = new VoiceResponse()
    vr.say({ voice: "Polly.Joanna-Neural", language: "en-US" }, "Hello")
    vr.hangup()
    const xml = vr.toString()
    expect(xml).toContain("<Response>")
    expect(xml).toContain("<Say voice=\"Polly.Joanna-Neural\" language=\"en-US\">Hello</Say>")
    expect(xml).toContain("<Hangup/>")
    expect(xml).not.toMatch(/twilio/i)
  })

  it("builds Dial with Number url + callerId", () => {
    const vr = new VoiceResponse()
    const dial = vr.dial({ callerId: "+15025551212", timeout: 25, answerOnBridge: true })
    dial.number({ url: "https://lyncr.app/answer", method: "POST" }, "+15025550000")
    const xml = vr.toString()
    expect(xml).toContain('callerId="+15025551212"')
    expect(xml).toContain('answerOnBridge="true"')
    expect(xml).toContain("<Number")
    expect(xml).toContain("+15025550000")
  })

  it("builds Gather with nested Say", () => {
    const vr = new VoiceResponse()
    const gather = vr.gather({ input: ["speech", "dtmf"], numDigits: 1, timeout: 6 })
    gather.say({ voice: "Polly.Joanna-Neural" }, "Press 1")
    expect(vr.toString()).toContain('<Gather input="speech dtmf" numDigits="1" timeout="6">')
    expect(vr.toString()).toContain("Press 1")
  })
})
