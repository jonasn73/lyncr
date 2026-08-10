import { describe, expect, it } from "vitest"
import {
  buildUnreachableFollowUpSms,
  crmCallbackOutcomeLabel,
  formatCrmBookedStatusLabel,
  isCalledAnsweredOutcome,
  isCalledNoAnswerOutcome,
  leadCallbackOutcomeFromCollected,
} from "@/lib/unreachable-follow-up"

describe("unreachable follow-up SMS", () => {
  it("uses the business name and first name", () => {
    expect(
      buildUnreachableFollowUpSms({
        customerName: "Sam Johnson",
        businessName: "Key Squad 502",
      })
    ).toBe(
      "Hi Sam, a technician from Key Squad 502 called and couldn’t reach you. Reply here or book."
    )
  })

  it("appends a short link when provided", () => {
    const text = buildUnreachableFollowUpSms({
      customerName: "Ava",
      businessName: "Key Squad 502",
      shortLink: "https://lyncr.app/b/abc",
    })
    expect(text).toContain("https://lyncr.app/b/abc")
    expect(text).toContain("Key Squad 502")
  })

  it("detects called_no_answer and called_answered from collected JSON", () => {
    expect(isCalledNoAnswerOutcome({ callback_outcome: "called_no_answer" })).toBe(true)
    expect(isCalledAnsweredOutcome({ callback_outcome: "called_answered" })).toBe(true)
    expect(leadCallbackOutcomeFromCollected({ called_answered_at: "2026-08-09T12:00:00Z" })).toBe(
      "called_answered"
    )
    expect(isCalledNoAnswerOutcome({})).toBe(false)
  })

  it("labels callback outcomes for CRM badges", () => {
    expect(crmCallbackOutcomeLabel("called_no_answer")).toBe("Called · no answer")
    expect(crmCallbackOutcomeLabel("called_answered")).toBe("Called · answered")
  })

  it("formats booked status with a time", () => {
    const label = formatCrmBookedStatusLabel("2026-08-09T23:30:00.000Z")
    expect(label.startsWith("Booked ·")).toBe(true)
  })
})
