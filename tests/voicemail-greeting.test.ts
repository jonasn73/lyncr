import { describe, expect, it } from "vitest"
import {
  buildProfessionalVoicemailGreeting,
  isGenericVoicemailGreeting,
  resolveVoicemailGreetingText,
} from "@/lib/voicemail-greeting"

describe("voicemail greeting", () => {
  it("builds branded professional copy", () => {
    const text = buildProfessionalVoicemailGreeting("Key Squad 502")
    expect(text).toContain("Thank you for calling Key Squad 502")
    expect(text).toContain("after the tone")
    expect(text).not.toContain("beep")
  })

  it("treats legacy placeholders as generic", () => {
    expect(isGenericVoicemailGreeting("Please leave a message after the beep.")).toBe(true)
    expect(isGenericVoicemailGreeting("")).toBe(true)
    expect(
      isGenericVoicemailGreeting(
        "Thank you for calling Key Squad. Please leave your name and number after the tone."
      )
    ).toBe(false)
  })

  it("prefers custom greeting when set", () => {
    const custom = "You have reached Acme Plumbing after hours. Leave a detailed message."
    expect(resolveVoicemailGreetingText({ customGreeting: custom, organizationName: "Acme" })).toBe(custom)
  })

  it("uses organization name when custom greeting is generic", () => {
    const text = resolveVoicemailGreetingText({
      customGreeting: "Please leave a message after the beep.",
      organizationName: "Key Squad 502",
      businessName: "Jonas Locksmith",
    })
    expect(text).toContain("Key Squad 502")
    expect(text).toContain("Thank you for calling")
  })
})
