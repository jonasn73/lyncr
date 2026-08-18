import { describe, expect, it } from "vitest"
import {
  AMBER_SILENT_LEFTOVER_MS,
  amberLeftoverMatchesHandledJob,
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

describe("amberLeftoverMatchesHandledJob", () => {
  it("matches leftover by lead id or last 10 phone digits", () => {
    expect(
      amberLeftoverMatchesHandledJob({
        threadLeadId: "lead-1",
        threadPhone: "+15025550112",
        leadId: "lead-1",
      })
    ).toBe(true)
    expect(
      amberLeftoverMatchesHandledJob({
        threadLeadId: "lead-1",
        threadPhone: "+15025550112",
        customerPhone: "(502) 555-0112",
      })
    ).toBe(true)
    expect(
      amberLeftoverMatchesHandledJob({
        threadLeadId: "lead-1",
        threadPhone: "+15025550112",
        leadId: "other",
        customerPhone: "+15025550999",
      })
    ).toBe(false)
  })
})

describe("parseAmberCoworkerCommand", () => {
  it("treats yes and send it as send", () => {
    expect(isAmberSendKeyword("SEND")).toBe(true)
    expect(isAmberSendKeyword("yes")).toBe(true)
    expect(isAmberSendKeyword("ok")).toBe(true)
    expect(isAmberSendKeyword("yeah send it")).toBe(true)
    expect(isAmberSendKeyword("yes tell him tomorrow")).toBe(false)
    expect(parseAmberCoworkerCommand("SEND").kind).toBe("send")
    expect(parseAmberCoworkerCommand("ok").kind).toBe("send")
  })

  it("parses skip words including skip this and skip Noah", () => {
    expect(isAmberSkipKeyword("SKIP")).toBe(true)
    expect(isAmberSkipKeyword("skip this")).toBe(true)
    expect(isAmberSkipKeyword("don't text them")).toBe(true)
    expect(isAmberSkipKeyword("don’t text them")).toBe(true)
    expect(isAmberSkipKeyword("nevermind")).toBe(true)
    expect(isAmberSkipKeyword("Skip noah")).toBe(true)
    expect(isAmberSkipKeyword("skip Noah Medley")).toBe(true)
    expect(isAmberSkipKeyword("don't text noah")).toBe(true)
    expect(isAmberSkipKeyword("skip until tomorrow")).toBe(false)
    expect(parseAmberCoworkerCommand("LATER").kind).toBe("skip")
    expect(parseAmberCoworkerCommand("skip noah").kind).toBe("skip")
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
  it("treats BUSY and I'm slammed as presence", () => {
    expect(isBareAmberPresenceCommand("BUSY until 4:30")).toBe(true)
    expect(isBareAmberPresenceCommand("I'm slammed until 4")).toBe(true)
    expect(isBareAmberPresenceCommand("What’s my status")).toBe(true)
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
      draftBody: "Hi Joe — we got your request. We’ll follow up. — Key Squad 502",
    })
    expect(text).toContain("Joe McCants")
    expect(text).toContain("…2716")
    expect(text).toContain("I’d send")
    expect(text).toContain("ok")
    expect(text).toContain("15 min")
    expect(text).not.toContain("SEND")
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
  it("waits 15 minutes after the ping", () => {
    const pinged = new Date("2026-08-17T16:00:00.000Z")
    expect(
      isAmberSilentLeftoverDue({
        pingedAt: pinged,
        now: new Date("2026-08-17T16:14:00.000Z"),
        waitMs: AMBER_SILENT_LEFTOVER_MS,
      })
    ).toBe(false)
    expect(
      isAmberSilentLeftoverDue({
        pingedAt: pinged,
        now: new Date("2026-08-17T16:15:00.000Z"),
        waitMs: AMBER_SILENT_LEFTOVER_MS,
      })
    ).toBe(true)
  })
})
