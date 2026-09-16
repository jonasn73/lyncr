import { describe, expect, it } from "vitest"
import { parseSmsOptOutKeyword } from "@/lib/sms-opt-out"
import { renderTemplate } from "@/lib/sms-pipeline"

describe("parseSmsOptOutKeyword", () => {
  it("matches the CTIA stop keywords, exact word only", () => {
    for (const w of ["STOP", "stop", "StopAll", "unsubscribe", "CANCEL", "End", "quit", "Stop.", "stop!"]) {
      expect(parseSmsOptOutKeyword(w)).toBe("stop")
    }
  })

  it("matches re-opt-in keywords", () => {
    for (const w of ["START", "unstop", "yes"]) {
      expect(parseSmsOptOutKeyword(w)).toBe("start")
    }
  })

  it("never treats sentences as opt-outs — the carrier applies the same rule", () => {
    expect(parseSmsOptOutKeyword("stop by anytime")).toBeNull()
    expect(parseSmsOptOutKeyword("please cancel my appointment")).toBeNull()
    expect(parseSmsOptOutKeyword("can you stop and grab a key blank")).toBeNull()
    expect(parseSmsOptOutKeyword("yes still need help with the car")).toBeNull()
    expect(parseSmsOptOutKeyword("")).toBeNull()
  })
})

describe("template time_slot handling", () => {
  const template =
    "Hi {{customer_name}}, your appointment with {{business_name}} is booked for {{time_slot}}. Reply here if anything changes."

  it("includes the time when we have one", () => {
    expect(
      renderTemplate(template, {
        customer_name: "Jade",
        business_name: "Key Squad 502",
        time_slot: "Tue, Sep 17 at 2:00 PM",
      })
    ).toBe(
      "Hi Jade, your appointment with Key Squad 502 is booked for Tue, Sep 17 at 2:00 PM. Reply here if anything changes."
    )
  })

  it("drops the whole time phrase when there is none — never 'booked for .'", () => {
    expect(
      renderTemplate(template, {
        customer_name: "Jade",
        business_name: "Key Squad 502",
        time_slot: "",
      })
    ).toBe("Hi Jade, your appointment with Key Squad 502 is booked. Reply here if anything changes.")
  })
})
