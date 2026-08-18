import { describe, expect, it } from "vitest"
import {
  AMBER_SILENT_LEFTOVER_MS,
  buildAmberLeftoverPingText,
  buildCustomerDraftFromInstruction,
  buildGotItHoldingCustomerSms,
  buildGotItOwnerRecapSms,
  isAmberSendKeyword,
  isAmberSilentLeftoverDue,
  isAmberSkipKeyword,
  isBareAmberPresenceCommand,
  parseAmberCoworkerCommand,
  shouldHoldLeftoverPing,
} from "@/lib/amber-coworker-commands"

describe("parseAmberCoworkerCommand", () => {
  it("only treats exact SEND as send", () => {
    expect(isAmberSendKeyword("SEND")).toBe(true)
    expect(isAmberSendKeyword("yes")).toBe(false)
    expect(isAmberSendKeyword("ok")).toBe(false)
    expect(parseAmberCoworkerCommand("SEND").kind).toBe("send")
  })

  it("parses skip words", () => {
    expect(isAmberSkipKeyword("SKIP")).toBe(true)
    expect(isAmberSkipKeyword("don't")).toBe(true)
    expect(parseAmberCoworkerCommand("LATER").kind).toBe("skip")
  })

  it("treats other text as instruction", () => {
    const cmd = parseAmberCoworkerCommand("tell him we don't have a tech until tomorrow")
    expect(cmd.kind).toBe("instruction")
    if (cmd.kind === "instruction") {
      expect(cmd.text.toLowerCase()).toContain("tech")
    }
  })
})

describe("isBareAmberPresenceCommand", () => {
  it("treats BUSY as presence and a sentence as instruction", () => {
    expect(isBareAmberPresenceCommand("BUSY until 4:30")).toBe(true)
    expect(isBareAmberPresenceCommand("tell him I'm on a job until tomorrow")).toBe(false)
  })
})

describe("shouldHoldLeftoverPing", () => {
  it("holds window jobs at night and lets ASAP through", () => {
    const night = new Date("2026-08-17T03:00:00.000Z")
    expect(
      shouldHoldLeftoverPing({ urgency: "window", timezone: "America/New_York", now: night })
    ).toBe(true)
    expect(
      shouldHoldLeftoverPing({ urgency: "asap", timezone: "America/New_York", now: night })
    ).toBe(false)
  })
})

describe("draft copy", () => {
  it("builds a customer SMS from owner instruction", () => {
    const draft = buildCustomerDraftFromInstruction({
      instruction: "tell him we don't have a technician until tomorrow",
      customerFirstName: "Joe",
      businessName: "Key Squad 502",
    })
    expect(draft.toLowerCase()).toContain("joe")
    expect(draft.toLowerCase()).toContain("tomorrow")
    expect(draft).toContain("Key Squad 502")
  })

  it("asks what to do on leftover ping", () => {
    const text = buildAmberLeftoverPingText({
      customerName: "Joe McCants",
      jobLabel: "lost key",
      addressSnippet: "412 Oak, Louisville",
      minutesAgo: 40,
      urgency: "asap",
      last4: "2716",
    })
    expect(text).toContain("Joe McCants")
    expect(text).toContain("…2716")
    expect(text).toContain("45 min")
    expect(text).toContain("SEND")
  })

  it("builds a holding SMS with no times or prices", () => {
    const text = buildGotItHoldingCustomerSms({
      customerFirstName: "Joe",
      businessName: "Key Squad 502",
    })
    expect(text).toContain("Joe")
    expect(text).toContain("Key Squad 502")
    expect(text.toLowerCase()).toContain("got your request")
    expect(text.toLowerCase()).not.toContain("shortly")
    expect(text.toLowerCase()).not.toContain("on the way")
  })

  it("recaps the owner after auto-hold", () => {
    expect(buildGotItOwnerRecapSms({ customerFirstName: "Joe" })).toContain("Told Joe")
    expect(buildGotItOwnerRecapSms({ customerFirstName: "Joe", alreadySent: true })).toContain(
      "already got"
    )
  })
})

describe("isAmberSilentLeftoverDue", () => {
  it("waits 45 minutes after the ping", () => {
    const pinged = new Date("2026-08-17T16:00:00.000Z")
    expect(
      isAmberSilentLeftoverDue({
        pingedAt: pinged,
        now: new Date("2026-08-17T16:44:00.000Z"),
        waitMs: AMBER_SILENT_LEFTOVER_MS,
      })
    ).toBe(false)
    expect(
      isAmberSilentLeftoverDue({
        pingedAt: pinged,
        now: new Date("2026-08-17T16:45:00.000Z"),
        waitMs: AMBER_SILENT_LEFTOVER_MS,
      })
    ).toBe(true)
  })
})
