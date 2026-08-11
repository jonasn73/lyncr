import { describe, expect, it } from "vitest"
import {
  buildUnreachableFollowUpSms,
  crmCallbackOutcomeLabel,
  formatCrmBookedStatusLabel,
  formatCrmListRowMeta,
  isCalledAnsweredOutcome,
  isCalledNoAnswerOutcome,
  isCrmBookedStatusLabel,
  isCrmPreBookStatusLabel,
  isCrmTerminalStatusLabel,
  leadCallbackOutcomeFromCollected,
  resolveCrmJobStatusPresentation,
  shouldShowCrmLifecycleCard,
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

  it("classifies CRM lifecycle status labels", () => {
    expect(isCrmPreBookStatusLabel("Needs call")).toBe(true)
    expect(isCrmPreBookStatusLabel("Called · answered")).toBe(true)
    expect(isCrmBookedStatusLabel("Booked · Aug 9, 7:30 PM")).toBe(true)
    expect(isCrmTerminalStatusLabel("Cancelled")).toBe(true)
    expect(isCrmTerminalStatusLabel("Complete")).toBe(true)
    expect(
      shouldShowCrmLifecycleCard({
        isOpenLead: true,
        statusLabel: "Needs call",
        navAction: "Book job",
      })
    ).toBe(true)
    expect(
      shouldShowCrmLifecycleCard({
        isOpenLead: false,
        statusLabel: "Booked · Aug 9, 7:30 PM",
        navAction: "Open job",
      })
    ).toBe(true)
    expect(
      shouldShowCrmLifecycleCard({
        isOpenLead: false,
        statusLabel: "Cancelled",
        navAction: "View job",
      })
    ).toBe(true)
  })
})

describe("CRM list job status", () => {
  it("resolves Needs call / Called · no answer / Price quoted for open leads", () => {
    expect(
      resolveCrmJobStatusPresentation({
        dispatchStatus: "lead",
        jobStatus: "lead",
      }).status_label
    ).toBe("Needs call")
    expect(
      resolveCrmJobStatusPresentation({
        dispatchStatus: "lead",
        jobStatus: "lead",
        callbackOutcome: "called_no_answer",
      }).status_label
    ).toBe("Called · no answer")
    expect(
      resolveCrmJobStatusPresentation({
        dispatchStatus: "lead",
        jobStatus: "lead",
        hasQuotedPrice: true,
      }).status_label
    ).toBe("Price quoted")
  })

  it("resolves Booked · time, Complete, and Cancelled", () => {
    const booked = resolveCrmJobStatusPresentation({
      dispatchStatus: "dispatched",
      jobStatus: "assigned",
      scheduledAt: "2026-08-09T23:30:00.000Z",
    })
    expect(booked.status_label.startsWith("Booked ·")).toBe(true)
    expect(
      resolveCrmJobStatusPresentation({
        dispatchStatus: "completed",
        jobStatus: "completed",
      }).status_label
    ).toBe("Complete")
    expect(
      resolveCrmJobStatusPresentation({
        dispatchStatus: "cancelled",
        jobStatus: "cancelled",
      }).status_label
    ).toBe("Cancelled")
  })

  it("formats list secondary meta with status first and open count", () => {
    expect(
      formatCrmListRowMeta({
        statusLabel: "Needs call",
        openLeadCount: 1,
        jobsCompleted: 0,
      })
    ).toBe("Needs call · 1 open")
    expect(
      formatCrmListRowMeta({
        statusLabel: "Complete",
        openLeadCount: 0,
        jobsCompleted: 1,
      })
    ).toBe("Complete")
    expect(
      formatCrmListRowMeta({
        statusLabel: null,
        openLeadCount: 0,
        jobsCompleted: 2,
      })
    ).toBe("2 jobs")
  })
})
