import { describe, expect, it } from "vitest"
import {
  formatMissedTickerLabel,
  summarizeMissedLeadInsights,
} from "@/lib/missed-lead-aggregation"

const NOW = new Date("2026-07-12T18:00:00-04:00")

function minsAgo(mins: number): string {
  return new Date(NOW.getTime() - mins * 60_000).toISOString()
}

describe("summarizeMissedLeadInsights", () => {
  it("counts unique leads when one person rings multiple times", () => {
    const result = summarizeMissedLeadInsights(
      [
        {
          id: "1",
          from_number: "+15025550101",
          created_at: minsAgo(5),
          call_type: "missed",
          status: "no-answer",
        },
        {
          id: "2",
          from_number: "+15025550101",
          created_at: minsAgo(12),
          call_type: "missed",
          status: "canceled",
        },
        {
          id: "3",
          from_number: "+15025550909",
          created_at: minsAgo(8),
          call_type: "voicemail",
          status: "completed",
        },
      ],
      { now: NOW }
    )
    expect(result.totalMissedToday).toBe(3)
    expect(result.uniqueLeadsToday).toBe(2)
    expect(result.recentUnreturned).toHaveLength(2)
  })

  it("excludes intercepted phones from the recovery banner list", () => {
    const result = summarizeMissedLeadInsights(
      [
        {
          id: "1",
          from_number: "+15025550101",
          created_at: minsAgo(3),
          call_type: "missed",
          status: "no-answer",
        },
      ],
      { now: NOW, interceptedKeys: new Set(["5025550101"]) }
    )
    expect(result.recentUnreturned).toHaveLength(0)
    expect(result.uniqueLeadsToday).toBe(1)
  })

  it("ignores misses older than the recent window for the banner", () => {
    const result = summarizeMissedLeadInsights(
      [
        {
          id: "1",
          from_number: "+15025550101",
          created_at: minsAgo(45),
          call_type: "missed",
          status: "no-answer",
        },
      ],
      { now: NOW }
    )
    expect(result.uniqueLeadsToday).toBe(1)
    expect(result.recentUnreturned).toHaveLength(0)
  })
})

describe("formatMissedTickerLabel", () => {
  it("highlights unique leads when lower than total rings", () => {
    expect(formatMissedTickerLabel(8, 3)).toBe("8 MISSED (3 LEADS)")
    expect(formatMissedTickerLabel(3, 3)).toBe("MISSED")
    expect(formatMissedTickerLabel(0, 0)).toBe("MISSED")
  })
})
