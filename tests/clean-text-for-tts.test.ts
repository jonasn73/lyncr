import { describe, expect, it } from "vitest"
import {
  cleanTextForTTS,
  getCallControlSpeakVoiceAttributes,
  normalizeCallControlSpeakVoice,
  texmlSayMessageBody,
} from "@/lib/texml-say-voice"

describe("cleanTextForTTS", () => {
  it("speaks Key Squad 502 as five oh two without changing other words", () => {
    expect(cleanTextForTTS("Thanks for calling Key Squad 502.")).toBe(
      "Thanks for calling Key Squad five oh two."
    )
    expect(cleanTextForTTS("Area code 502 lockouts")).toBe("Area code five oh two lockouts")
    expect(cleanTextForTTS("Key Squad 5-0-2")).toBe("Key Squad five oh two")
    expect(cleanTextForTTS("Key Squad 5o2")).toBe("Key Squad five oh two")
  })

  it("applies phonetic cleanup inside texmlSayMessageBody", () => {
    const prev = process.env.ZING_TEXML_SAY_SSML
    process.env.ZING_TEXML_SAY_SSML = "0"
    try {
      expect(texmlSayMessageBody("Thank you for calling Key Squad 502.")).toContain(
        "Key Squad five oh two"
      )
    } finally {
      if (prev === undefined) delete process.env.ZING_TEXML_SAY_SSML
      else process.env.ZING_TEXML_SAY_SSML = prev
    }
  })
})

describe("normalizeCallControlSpeakVoice", () => {
  it("upgrades Twilio-style Polly to AWS.Polly for Call Control Speak", () => {
    expect(normalizeCallControlSpeakVoice("Polly.Joanna-Neural")).toBe("AWS.Polly.Joanna-Neural")
    expect(normalizeCallControlSpeakVoice("Polly.Matthew-Neural")).toBe("AWS.Polly.Matthew-Neural")
  })

  it("upgrades robotic alice / man / woman to neural Joanna", () => {
    expect(normalizeCallControlSpeakVoice("alice")).toBe("AWS.Polly.Joanna-Neural")
    expect(normalizeCallControlSpeakVoice("woman")).toBe("AWS.Polly.Joanna-Neural")
  })

  it("leaves already-prefixed provider voices alone", () => {
    expect(normalizeCallControlSpeakVoice("AWS.Polly.Joanna-Neural")).toBe(
      "AWS.Polly.Joanna-Neural"
    )
    expect(normalizeCallControlSpeakVoice("Telnyx.NaturalHD.astra")).toBe(
      "Telnyx.NaturalHD.astra"
    )
  })

  it("defaults Call Control speak attrs to AWS.Polly.Joanna-Neural", () => {
    const prevCc = process.env.ZING_CALL_CONTROL_SPEAK_VOICE
    const prevTexml = process.env.ZING_TEXML_SAY_VOICE
    delete process.env.ZING_CALL_CONTROL_SPEAK_VOICE
    delete process.env.ZING_TEXML_SAY_VOICE
    try {
      expect(getCallControlSpeakVoiceAttributes().voice).toBe("AWS.Polly.Joanna-Neural")
    } finally {
      if (prevCc === undefined) delete process.env.ZING_CALL_CONTROL_SPEAK_VOICE
      else process.env.ZING_CALL_CONTROL_SPEAK_VOICE = prevCc
      if (prevTexml === undefined) delete process.env.ZING_TEXML_SAY_VOICE
      else process.env.ZING_TEXML_SAY_VOICE = prevTexml
    }
  })
})
