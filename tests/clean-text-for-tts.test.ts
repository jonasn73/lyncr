import { describe, expect, it } from "vitest"
import { cleanTextForTTS, texmlSayMessageBody } from "@/lib/texml-say-voice"

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
