import { describe, expect, it } from "vitest"
import {
  formatRepeatAttemptBadgeLabel,
  formatRepeatCallerHistoryLine,
  resolveRepeatCallerUrgency,
} from "@/lib/repeat-caller-urgency"

const NOW = new Date("2026-07-12T18:00:00-04:00")

function minsAgo(mins: number): string {
  return new Date(NOW.getTime() - mins * 60_000).toISOString()
}

describe("resolveRepeatCallerUrgency", () => {
  it("returns non-urgent for a first-time caller", () => {
    const result = resolveRepeatCallerUrgency("+15025551212", [], { now: NOW })
    expect(result.isHighUrgency).toBe(false)
    expect(result.attemptCount).toBe(1)
    expect(result.previousMissedCount).toBe(0)
  })

  it("flags high urgency when a prior miss exists in the last 2 hours", () => {
    const result = resolveRepeatCallerUrgency(
      "+15025551212",
      [
        {
          id: "miss-1",
          from_number: "+15025551212",
          created_at: minsAgo(18),
          call_type: "missed",
          status: "no-answer",
        },
        {
          id: "live-ring",
          from_number: "+15025551212",
          created_at: minsAgo(0),
          call_type: "incoming",
          status: "ringing",
        },
      ],
      { now: NOW, excludeCallId: "live-ring" }
    )
    expect(result.isHighUrgency).toBe(true)
    expect(result.attemptCount).toBe(2)
    expect(result.previousMissedCount).toBe(1)
    expect(result.minutesSinceLastMissed).toBe(18)
  })

  it("ignores misses older than 2 hours even on the same calendar day", () => {
    const result = resolveRepeatCallerUrgency(
      "+15025551212",
      [
        {
          id: "old",
          from_number: "+15025551212",
          created_at: minsAgo(150),
          call_type: "missed",
          status: "canceled",
        },
      ],
      { now: NOW }
    )
    expect(result.isHighUrgency).toBe(false)
    expect(result.attemptCount).toBe(1)
  })

  it("matches phones with different formatting", () => {
    const result = resolveRepeatCallerUrgency(
      "(502) 555-1212",
      [
        {
          id: "a",
          callerNumber: "+1 502 555 1212",
          createdAt: minsAgo(5),
          rawCallType: "incoming",
          callStatus: "no-answer",
        },
      ],
      { now: NOW }
    )
    expect(result.attemptCount).toBe(2)
    expect(result.isHighUrgency).toBe(true)
  })
})

describe("formatters", () => {
  it("formats badge and history lines", () => {
    expect(formatRepeatAttemptBadgeLabel(3)).toBe("Attempt #3 • High Urgency")
    expect(formatRepeatCallerHistoryLine(0)).toBe("Last attempt was missed just now.")
    expect(formatRepeatCallerHistoryLine(1)).toBe("Last attempt was missed 1 minute ago.")
    expect(formatRepeatCallerHistoryLine(12)).toBe("Last attempt was missed 12 minutes ago.")
  })
})
