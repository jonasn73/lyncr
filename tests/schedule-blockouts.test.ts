import { describe, expect, it } from "vitest"
import {
  isDateFullyBlocked,
  slotOverlapsBlockout,
  resolveInboundCalendarOverride,
} from "@/lib/schedule-blockouts"
import { suggestNextOpenTime } from "@/lib/intake-schedule-helpers"
import type { ScheduleBlockout, SchedulerEvent } from "@/lib/types"

function blockout(partial: Partial<ScheduleBlockout> & Pick<ScheduleBlockout, "date">): ScheduleBlockout {
  return {
    id: partial.id || "b1",
    user_id: "u1",
    organization_id: null,
    date: partial.date,
    is_full_day: partial.is_full_day ?? false,
    start_time: partial.start_time ?? null,
    end_time: partial.end_time ?? null,
    reason: partial.reason ?? null,
    created_at: "",
    updated_at: "",
  }
}

describe("schedule blockouts", () => {
  it("flags full-day dates as blocked", () => {
    const rows = [blockout({ date: "2026-07-14", is_full_day: true })]
    expect(isDateFullyBlocked(rows, "2026-07-14")).toBe(true)
    expect(isDateFullyBlocked(rows, "2026-07-15")).toBe(false)
  })

  it("detects 1-hour slot overlap with a partial window", () => {
    const rows = [
      blockout({ date: "2026-07-14", start_time: "10:30", end_time: "12:00" }),
    ]
    expect(slotOverlapsBlockout(rows, "2026-07-14", "10:00", 60)).toBe(true)
    expect(slotOverlapsBlockout(rows, "2026-07-14", "11:00", 60)).toBe(true)
    expect(slotOverlapsBlockout(rows, "2026-07-14", "12:00", 60)).toBe(false)
    expect(slotOverlapsBlockout(rows, "2026-07-14", "09:00", 60)).toBe(false)
  })

  it("resolves inbound calendar overrides for full-day and currently-busy", () => {
    const fullDay = [blockout({ date: "2026-07-13", is_full_day: true, reason: "Vacation" })]
    // 10:45 AM EDT on Jul 13 2026 = 14:45 UTC
    const at1045 = new Date("2026-07-13T14:45:00.000Z")
    const full = resolveInboundCalendarOverride(fullDay, at1045)
    expect(full?.kind).toBe("full_day")
    expect(full?.dateKey).toBe("2026-07-13")

    const partial = [
      blockout({
        date: "2026-07-13",
        start_time: "10:00",
        end_time: "11:00",
        reason: "Doctor Appointment",
      }),
    ]
    const busy = resolveInboundCalendarOverride(partial, at1045)
    expect(busy?.kind).toBe("partial")
    expect(busy?.blockout.reason).toBe("Doctor Appointment")

    const free = resolveInboundCalendarOverride(partial, new Date("2026-07-13T16:00:00.000Z")) // 12:00 EDT
    expect(free).toBeNull()
  })

  it("suggestNextOpenTime skips full-day and overlapping windows", () => {
    const events: SchedulerEvent[] = []
    const fullDay = [blockout({ date: "2026-07-14", is_full_day: true })]
    expect(suggestNextOpenTime(events, "2026-07-14", 60, null, null, 7, 19, fullDay)).toBeNull()

    const partial = [
      blockout({ date: "2026-07-14", start_time: "07:00", end_time: "10:00" }),
    ]
    expect(suggestNextOpenTime(events, "2026-07-14", 60, null, null, 7, 19, partial)).toBe("10:00")
  })
})
