import { describe, expect, it } from "vitest"
import {
  digitsMatchIvrBypass,
  isHolidayOverrideActive,
  normalizeIvrBypassCode,
  resolveAutomationGatherNumDigits,
  resolveHolidayGreetingText,
  resolveIvrTexmlVoice,
} from "@/lib/ivr-automation-settings"
import { buildAutomationPresenceGatherXml } from "@/lib/ivr-automation-texml"
import { DEFAULT_ACCOUNT_PRESENCE } from "@/lib/account-presence"

describe("ivr automation settings", () => {
  it("maps voice personas to Polly TeXML voices", () => {
    expect(resolveIvrTexmlVoice("en-US-Standard-C")).toBe("Polly.Joanna-Neural")
    expect(resolveIvrTexmlVoice("en-US-Standard-B")).toBe("Polly.Matthew-Neural")
    expect(resolveIvrTexmlVoice("Polly.Joanna-Neural")).toBe("Polly.Joanna-Neural")
  })

  it("normalizes bypass codes and match digits", () => {
    expect(normalizeIvrBypassCode("12-34")).toBe("1234")
    expect(normalizeIvrBypassCode("")).toBe(null)
    expect(digitsMatchIvrBypass("9", "9")).toBe(true)
    expect(digitsMatchIvrBypass("1", "9")).toBe(false)
    expect(resolveAutomationGatherNumDigits("1234")).toBe(4)
    expect(resolveAutomationGatherNumDigits(null)).toBe(1)
  })

  it("detects holiday override windows", () => {
    const now = new Date("2026-12-25T15:00:00.000Z")
    const fields = {
      holidayOverrideStart: "2026-12-24T00:00:00.000Z",
      holidayOverrideEnd: "2026-12-26T23:59:59.000Z",
      holidayGreetingText: "Closed for Christmas. Press 1 to book.",
    }
    expect(isHolidayOverrideActive(fields, now)).toBe(true)
    expect(resolveHolidayGreetingText(fields, now)).toContain("Christmas")
    expect(
      isHolidayOverrideActive(fields, new Date("2026-12-20T12:00:00.000Z"))
    ).toBe(false)
  })

  it("builds Gather with holiday text and persona voice", () => {
    const xml = buildAutomationPresenceGatherXml({
      kind: "holiday",
      actionUrl: "https://lyncr.app/api/telnyx-capture?step=presence-holiday",
      presence: {
        ...DEFAULT_ACCOUNT_PRESENCE,
        ivrBypassCode: "99",
        ivrVoiceEngineModel: "en-US-Standard-B",
        holidayOverrideStart: "2026-01-01T00:00:00.000Z",
        holidayOverrideEnd: "2099-01-01T00:00:00.000Z",
        holidayGreetingText: "Happy New Year from Key Squad.",
      },
      now: new Date("2026-07-01T12:00:00.000Z"),
    })
    expect(xml).toContain("Happy New Year from Key Squad.")
    expect(xml).toContain('voice="Polly.Matthew-Neural"')
    expect(xml).toContain('numDigits="2"')
  })
})
