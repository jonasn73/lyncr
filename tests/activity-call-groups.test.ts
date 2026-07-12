import { describe, expect, it } from "vitest"
import {
  activityCallerPhoneKey,
  formatGroupedCallSummary,
  groupConsecutiveCallsByPhone,
} from "@/lib/activity-call-groups"
import type { UiCallRecord } from "@/lib/hooks/use-operations-data"

function makeCall(partial: Partial<UiCallRecord> & Pick<UiCallRecord, "id" | "callerNumber">): UiCallRecord {
  return {
    type: "incoming",
    callerName: "Unknown Caller",
    targetLineE164: "+15025550100",
    routedTo: "You",
    routedToReceptionistId: null,
    routedInitials: "YO",
    routedColor: "#22d3ee",
    date: "Today",
    time: "4:00 PM",
    createdAt: "2026-07-12T20:00:00.000Z",
    rawCallType: "incoming",
    callStatus: "completed",
    answeredAt: "2026-07-12T20:00:05.000Z",
    endedAt: "2026-07-12T20:01:00.000Z",
    durationSeconds: 55,
    hasRecording: false,
    recordingUrl: null,
    activity: null,
    ...partial,
  }
}

describe("groupConsecutiveCallsByPhone", () => {
  it("collapses consecutive same-number rows and keeps the newest timestamp", () => {
    const now = new Date("2026-07-12T21:00:00.000Z")
    const grouped = groupConsecutiveCallsByPhone(
      [
        makeCall({ id: "1", callerNumber: "+15551234567", createdAt: "2026-07-12T20:30:00.000Z" }),
        makeCall({ id: "2", callerNumber: "(555) 123-4567", createdAt: "2026-07-12T20:20:00.000Z" }),
        makeCall({
          id: "3",
          callerNumber: "+15559876543",
          callerName: "Other",
          createdAt: "2026-07-12T20:10:00.000Z",
        }),
        makeCall({ id: "4", callerNumber: "+15551234567", createdAt: "2026-07-12T19:00:00.000Z" }),
      ],
      now
    )

    expect(grouped).toHaveLength(3)
    expect(grouped[0].id).toBe("1")
    expect(grouped[0].count).toBe(2)
    expect(grouped[0].todayCount).toBe(2)
    expect(grouped[0].createdAt).toBe("2026-07-12T20:30:00.000Z")
    expect(grouped[1].id).toBe("3")
    expect(grouped[1].count).toBe(1)
    expect(grouped[2].id).toBe("4")
    expect(grouped[2].count).toBe(1)
  })

  it("normalizes +1 and 10-digit forms to the same key", () => {
    expect(activityCallerPhoneKey("+15551234567")).toBe("5551234567")
    expect(activityCallerPhoneKey("(555) 123-4567")).toBe("5551234567")
  })

  it("formats a grouped subtitle", () => {
    const now = new Date("2026-07-12T20:30:36.000Z")
    const group = groupConsecutiveCallsByPhone(
      [
        makeCall({ id: "1", callerNumber: "+15551234567", createdAt: "2026-07-12T20:30:00.000Z" }),
        makeCall({ id: "2", callerNumber: "+15551234567", createdAt: "2026-07-12T20:00:00.000Z" }),
      ],
      now
    )[0]
    expect(formatGroupedCallSummary(group, now)).toBe("Last answered 36s ago • 2 total calls today")
  })
})
