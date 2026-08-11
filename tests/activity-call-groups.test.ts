import { describe, expect, it } from "vitest"
import {
  activityCallCalendarDayKey,
  activityCallerPhoneKey,
  filterActivityCallGroups,
  formatCallChronologyStatus,
  formatGroupedCallCountLabel,
  formatGroupedCallSummary,
  groupCallsByPhoneAndDay,
  groupConsecutiveCallsByPhone,
  resolveCallWasAnswered,
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

describe("groupCallsByPhoneAndDay", () => {
  it("merges same phone across intervening callers on the same calendar day", () => {
    // 4 PM Eastern on 2026-07-12
    const now = new Date("2026-07-12T20:00:00.000Z")
    const grouped = groupCallsByPhoneAndDay(
      [
        makeCall({
          id: "1",
          callerNumber: "+15551234567",
          callerName: "Jeff Lanham",
          createdAt: "2026-07-12T15:31:00.000Z", // 11:31 AM ET
          time: "11:31 AM",
        }),
        makeCall({
          id: "other",
          callerNumber: "+15559876543",
          callerName: "Other",
          createdAt: "2026-07-12T15:00:00.000Z",
        }),
        makeCall({
          id: "2",
          callerNumber: "(555) 123-4567",
          callerName: "Jeff Lanham",
          createdAt: "2026-07-12T14:57:00.000Z", // 10:57 AM ET
          time: "10:57 AM",
        }),
        makeCall({
          id: "3",
          callerNumber: "+15551234567",
          callerName: "Jeff Lanham",
          createdAt: "2026-07-12T14:23:00.000Z", // 10:23 AM ET
          time: "10:23 AM",
        }),
      ],
      { now, timeZone: "America/New_York" }
    )

    expect(grouped).toHaveLength(2)
    expect(grouped[0].callerName).toBe("Jeff Lanham")
    expect(grouped[0].count).toBe(3)
    expect(grouped[0].members.map((m) => m.id)).toEqual(["1", "2", "3"])
    expect(grouped[0].groupKey).toBe("2026-07-12|5551234567")
    expect(grouped[1].id).toBe("other")
    expect(grouped[1].count).toBe(1)
  })

  it("does not merge the same phone across different calendar days", () => {
    const now = new Date("2026-07-13T16:00:00.000Z")
    const grouped = groupCallsByPhoneAndDay(
      [
        makeCall({
          id: "today",
          callerNumber: "+15551234567",
          createdAt: "2026-07-13T15:00:00.000Z",
        }),
        makeCall({
          id: "yesterday",
          callerNumber: "+15551234567",
          createdAt: "2026-07-12T15:00:00.000Z",
        }),
      ],
      { now, timeZone: "America/New_York" }
    )

    expect(grouped).toHaveLength(2)
    expect(grouped[0].id).toBe("today")
    expect(grouped[0].count).toBe(1)
    expect(grouped[1].id).toBe("yesterday")
    expect(grouped[1].count).toBe(1)
  })

  it("keeps unknown numbers as separate rows", () => {
    const grouped = groupCallsByPhoneAndDay(
      [
        makeCall({ id: "a", callerNumber: "—", createdAt: "2026-07-12T15:00:00.000Z" }),
        makeCall({ id: "b", callerNumber: "—", createdAt: "2026-07-12T14:00:00.000Z" }),
      ],
      { timeZone: "America/New_York" }
    )
    expect(grouped).toHaveLength(2)
  })
})

describe("filterActivityCallGroups", () => {
  it("keeps a day-group when any child matches and surfaces the latest match", () => {
    const groups = groupCallsByPhoneAndDay(
      [
        makeCall({
          id: "answered",
          callerNumber: "+15551234567",
          createdAt: "2026-07-12T16:00:00.000Z",
          type: "incoming",
          answeredAt: "2026-07-12T16:00:05.000Z",
        }),
        makeCall({
          id: "missed",
          callerNumber: "+15551234567",
          createdAt: "2026-07-12T15:00:00.000Z",
          type: "missed",
          answeredAt: null,
          callStatus: "no-answer",
          durationSeconds: 0,
        }),
      ],
      { timeZone: "America/New_York" }
    )

    const filtered = filterActivityCallGroups(groups, (c) => c.type === "missed")
    expect(filtered).toHaveLength(1)
    expect(filtered[0].id).toBe("missed")
    expect(filtered[0].count).toBe(2)
    expect(filtered[0].members).toHaveLength(2)
  })
})

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
    expect(grouped[0].members.map((m) => m.id)).toEqual(["1", "2"])
    expect(grouped[1].id).toBe("3")
    expect(grouped[1].count).toBe(1)
    expect(grouped[2].id).toBe("4")
    expect(grouped[2].count).toBe(1)
  })

  it("normalizes +1 and 10-digit forms to the same key", () => {
    expect(activityCallerPhoneKey("+15551234567")).toBe("5551234567")
    expect(activityCallerPhoneKey("(555) 123-4567")).toBe("5551234567")
  })

  it("formats a grouped subtitle and count label", () => {
    const now = new Date("2026-07-12T20:30:36.000Z")
    const group = groupCallsByPhoneAndDay(
      [
        makeCall({ id: "1", callerNumber: "+15551234567", createdAt: "2026-07-12T20:30:00.000Z" }),
        makeCall({ id: "2", callerNumber: "+15551234567", createdAt: "2026-07-12T20:00:00.000Z" }),
      ],
      { now, timeZone: "UTC" }
    )[0]
    expect(formatGroupedCallSummary(group, now)).toBe("Last answered 36s ago • 2 calls")
    expect(formatGroupedCallCountLabel(group.count)).toBe("· 2 calls")
    expect(activityCallCalendarDayKey("2026-07-12T20:30:00.000Z", "UTC")).toBe("2026-07-12")
  })

  it("labels IVR / no-answer chronology correctly (never plain Answered)", () => {
    expect(
      formatCallChronologyStatus(
        makeCall({
          id: "ivr",
          callerNumber: "+18594170996",
          routedTo: "IVR Menu",
          rawCallType: "missed",
          type: "missed",
          answeredAt: null,
          durationSeconds: 40,
        })
      )
    ).toBe("Missed / Left on IVR")
    expect(
      formatCallChronologyStatus(
        makeCall({
          id: "na",
          callerNumber: "+18594170996",
          routedTo: "You",
          rawCallType: "missed",
          type: "missed",
          callStatus: "no-answer",
          answeredAt: null,
          durationSeconds: 5,
        })
      )
    ).toBe("Missed / No Answer")
    expect(
      resolveCallWasAnswered(
        makeCall({
          id: "ivr2",
          callerNumber: "+18594170996",
          routedTo: "IVR Menu",
          answeredAt: "2026-07-13T13:33:00.000Z",
          endedAt: "2026-07-13T13:34:00.000Z",
          durationSeconds: 60,
        })
      )
    ).toBe(false)
  })
})
