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
  it("upgrades TeXML Polly to AWS.Polly for Call Control Speak", () => {
    expect(normalizeCallControlSpeakVoice("Polly.Joanna-Neural")).toBe("AWS.Polly.Joanna-Neural")
    expect(normalizeCallControlSpeakVoice("Polly.Matthew-Neural")).toBe("AWS.Polly.Matthew-Neural")
  })

  it("upgrades robotic alice / man / woman to NaturalHD astra", () => {
    expect(normalizeCallControlSpeakVoice("alice")).toBe("Telnyx.NaturalHD.astra")
    expect(normalizeCallControlSpeakVoice("woman")).toBe("Telnyx.NaturalHD.astra")
  })

  it("leaves already-prefixed provider voices alone", () => {
    expect(normalizeCallControlSpeakVoice("AWS.Polly.Joanna-Neural")).toBe(
      "AWS.Polly.Joanna-Neural"
    )
    expect(normalizeCallControlSpeakVoice("Telnyx.NaturalHD.astra")).toBe(
      "Telnyx.NaturalHD.astra"
    )
  })

  it("defaults Call Control speak attrs to Telnyx.NaturalHD.astra", () => {
    const prevCc = process.env.ZING_CALL_CONTROL_SPEAK_VOICE
    const prevLyncrCc = process.env.LYNCR_CALL_CONTROL_SPEAK_VOICE
    const prevTexml = process.env.ZING_TEXML_SAY_VOICE
    const prevLyncrTexml = process.env.LYNCR_TEXML_SAY_VOICE
    delete process.env.ZING_CALL_CONTROL_SPEAK_VOICE
    delete process.env.LYNCR_CALL_CONTROL_SPEAK_VOICE
    delete process.env.ZING_TEXML_SAY_VOICE
    delete process.env.LYNCR_TEXML_SAY_VOICE
    try {
      expect(getCallControlSpeakVoiceAttributes().voice).toBe("Telnyx.NaturalHD.astra")
    } finally {
      if (prevCc === undefined) delete process.env.ZING_CALL_CONTROL_SPEAK_VOICE
      else process.env.ZING_CALL_CONTROL_SPEAK_VOICE = prevCc
      if (prevLyncrCc === undefined) delete process.env.LYNCR_CALL_CONTROL_SPEAK_VOICE
      else process.env.LYNCR_CALL_CONTROL_SPEAK_VOICE = prevLyncrCc
      if (prevTexml === undefined) delete process.env.ZING_TEXML_SAY_VOICE
      else process.env.ZING_TEXML_SAY_VOICE = prevTexml
      if (prevLyncrTexml === undefined) delete process.env.LYNCR_TEXML_SAY_VOICE
      else process.env.LYNCR_TEXML_SAY_VOICE = prevLyncrTexml
    }
  })

  it("uses personaVoice over env override unless FORCE=1", () => {
    const prevCc = process.env.LYNCR_CALL_CONTROL_SPEAK_VOICE
    const prevZing = process.env.ZING_CALL_CONTROL_SPEAK_VOICE
    const prevForce = process.env.LYNCR_CALL_CONTROL_SPEAK_VOICE_FORCE
    process.env.LYNCR_CALL_CONTROL_SPEAK_VOICE = "AWS.Polly.Joanna-Neural"
    delete process.env.ZING_CALL_CONTROL_SPEAK_VOICE
    delete process.env.LYNCR_CALL_CONTROL_SPEAK_VOICE_FORCE
    try {
      expect(
        getCallControlSpeakVoiceAttributes({
          personaVoice: "AWS.Polly.Matthew-Neural",
        }).voice
      ).toBe("AWS.Polly.Matthew-Neural")
      process.env.LYNCR_CALL_CONTROL_SPEAK_VOICE_FORCE = "1"
      expect(
        getCallControlSpeakVoiceAttributes({
          personaVoice: "AWS.Polly.Matthew-Neural",
        }).voice
      ).toBe("AWS.Polly.Joanna-Neural")
    } finally {
      if (prevCc === undefined) delete process.env.LYNCR_CALL_CONTROL_SPEAK_VOICE
      else process.env.LYNCR_CALL_CONTROL_SPEAK_VOICE = prevCc
      if (prevZing === undefined) delete process.env.ZING_CALL_CONTROL_SPEAK_VOICE
      else process.env.ZING_CALL_CONTROL_SPEAK_VOICE = prevZing
      if (prevForce === undefined) delete process.env.LYNCR_CALL_CONTROL_SPEAK_VOICE_FORCE
      else process.env.LYNCR_CALL_CONTROL_SPEAK_VOICE_FORCE = prevForce
    }
  })
})
