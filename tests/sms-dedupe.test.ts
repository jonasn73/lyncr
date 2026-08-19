import { describe, expect, it } from "vitest"
import { smsBodiesLookDuplicate } from "@/lib/sms-dedupe"

describe("smsBodiesLookDuplicate", () => {
  it("treats two appointment-booked notes as the same text", () => {
    expect(
      smsBodiesLookDuplicate(
        "Hi Jade, your appointment with Key Squad 502 is booked. Reply here if anything changes.",
        "Hi Jade, your appointment with Key Squad 502 is booked. Reply here if anything changes."
      )
    ).toBe(true)
  })

  it("does not treat a book link and a booked note as the same", () => {
    expect(
      smsBodiesLookDuplicate(
        "Key Squad — still need help? Tell us when you need us: https://lyncr.app/b/XV4Q573D",
        "Hi Jade, your appointment with Key Squad 502 is booked. Reply here if anything changes."
      )
    ).toBe(false)
  })

  it("treats two couldn’t-reach follow-ups as the same", () => {
    expect(
      smsBodiesLookDuplicate(
        "Hey Jade — we tried calling and didn’t catch you. Text us here for any update or change. — Key Squad",
        "Hey Jade — we tried calling and didn’t catch you. Text us here for any update or change. — Key Squad 502"
      )
    ).toBe(true)
  })

  it("treats two missed-call book links as the same", () => {
    expect(
      smsBodiesLookDuplicate(
        "Sorry we missed your call — when you need us: https://lyncr.app/b/AAA",
        "Sorry we missed your call — when you need us: https://lyncr.app/b/BBB"
      )
    ).toBe(true)
  })
})
