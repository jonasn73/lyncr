import { describe, expect, it } from "vitest"
import {
  isBusyPresenceStatus,
  isManualPresenceLock,
  normalizePresenceStatus,
} from "@/lib/account-presence"
import {
  PRESENCE_CLOSED_PROMPT,
  PRESENCE_ON_JOB_PROMPT,
  buildPresenceClosedGatherXml,
  buildPresenceOnJobGatherXml,
} from "@/lib/inbound-time-capture"


/** Mirrors the <Say> escaping in lib/inbound-time-capture.ts. Asserting against the
 *  exported prompt constants (rather than copies of the wording) keeps these tests from
 *  going stale every time the script is reworded. */
const texmlEscape = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")

describe("account presence", () => {
  it("normalizes presence status aliases", () => {
    expect(normalizePresenceStatus("AVAILABLE")).toBe("AVAILABLE")
    expect(normalizePresenceStatus("on_job")).toBe("ON_JOB")
    expect(normalizePresenceStatus("busy")).toBe("ON_JOB")
    expect(normalizePresenceStatus("CLOSED")).toBe("CLOSED")
    expect(normalizePresenceStatus("off")).toBe("CLOSED")
    expect(normalizePresenceStatus("")).toBe("AVAILABLE")
  })

  it("treats Busy (ON_JOB) and Closed as cell-skipping presence", () => {
    expect(isBusyPresenceStatus("ON_JOB")).toBe(true)
    expect(isBusyPresenceStatus("CLOSED")).toBe(true)
    expect(isBusyPresenceStatus("AVAILABLE")).toBe(false)
  })

  it("locks any manual status — Available, Busy, or Closed — against calendar cron clears", () => {
    // Regression (087): a manual Available tap used to be unlocked (only Busy/Closed
    // locked), so the calendar cron could silently flip it back to Busy/Closed on the
    // next 5-minute tick with no visible cause. Now any manual set locks, regardless
    // of which status it is — the caller no longer needs to pass the status at all.
    expect(isManualPresenceLock(true)).toBe(true)
    // Calendar-driven writes (no manual lock) may still be cleared/overwritten.
    expect(isManualPresenceLock(false)).toBe(false)
    expect(isManualPresenceLock(null)).toBe(false)
  })

  it("builds presence Busy Gather prompts for Closed and On-Job steps", () => {
    const closed = buildPresenceClosedGatherXml(
      "https://lyncr.app/api/telnyx-capture?step=presence-closed"
    )
    // Unified Busy script (ON_JOB / CLOSED share one Speak).
    expect(closed).toContain(texmlEscape(PRESENCE_CLOSED_PROMPT))
    expect(closed).toContain("presence-closed")

    const onJob = buildPresenceOnJobGatherXml(
      "https://lyncr.app/api/telnyx-capture?step=presence-on-job"
    )
    expect(onJob).toContain(texmlEscape(PRESENCE_ON_JOB_PROMPT))
    expect(onJob).toContain("presence-on-job")

    // Product Busy greeting is shared across both presence steps.
    expect(PRESENCE_CLOSED_PROMPT).toBe(PRESENCE_ON_JOB_PROMPT)

    const custom = buildPresenceOnJobGatherXml(
      "https://lyncr.app/api/telnyx-capture?step=presence-on-job",
      "Custom on-job greeting from the dashboard."
    )
    expect(custom).toContain("Custom on-job greeting from the dashboard.")
  })
})
