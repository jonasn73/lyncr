import { describe, expect, it } from "vitest"
import {
  resolveScheduleInteractionPhase,
  scheduleInteractionActiveUntilMs,
} from "@/lib/scheduler-appointment-interaction"
import {
  combineScheduledDateTimeLocal,
  scheduledDateInputFromIso,
  scheduledTimeInputFromIso,
} from "@/lib/scheduler-utils"

describe("scheduler appointment interaction", () => {
  const scheduledAt = "2026-07-08T14:30:00-04:00"

  it("marks jobs within 30 minutes before start as upcoming", () => {
    const now = new Date("2026-07-08T14:05:00-04:00")
    expect(resolveScheduleInteractionPhase({ now, scheduled_at: scheduledAt })).toBe("upcoming")
  })

  it("marks jobs at start through the active window as active", () => {
    const now = new Date("2026-07-08T14:30:00-04:00")
    expect(resolveScheduleInteractionPhase({ now, scheduled_at: scheduledAt })).toBe("active")

    const nearGraceEnd = new Date("2026-07-08T14:44:00-04:00")
    expect(resolveScheduleInteractionPhase({ now: nearGraceEnd, scheduled_at: scheduledAt })).toBe(
      "active"
    )
  })

  it("marks jobs 30+ minutes late as overdue when not completed", () => {
    const now = new Date("2026-07-08T15:01:00-04:00")
    expect(resolveScheduleInteractionPhase({ now, scheduled_at: scheduledAt })).toBe("overdue")
  })

  it("skips interaction badges for completed jobs", () => {
    const now = new Date("2026-07-08T16:00:00-04:00")
    expect(
      resolveScheduleInteractionPhase({
        now,
        scheduled_at: scheduledAt,
        job_status: "completed",
      })
    ).toBe("completed")
  })

  it("extends active window to end of hour when later than 15-minute grace", () => {
    const scheduled = new Date("2026-07-08T14:30:00-04:00")
    const hourEnd = new Date("2026-07-08T15:00:00-04:00").getTime()
    const graceEnd = scheduled.getTime() + 15 * 60_000
    expect(scheduleInteractionActiveUntilMs(scheduled)).toBe(Math.max(hourEnd, graceEnd))
  })
})

describe("scheduler date/time inputs", () => {
  it("splits and recombines local date/time fields", () => {
    const iso = "2026-07-08T14:30:00-04:00"
    const date = scheduledDateInputFromIso(iso)
    const time = scheduledTimeInputFromIso(iso)
    expect(date).toMatch(/2026-07-08/)
    expect(time).toMatch(/14:30|2:30/)
    const combined = combineScheduledDateTimeLocal(date, time)
    expect(combined).toBeTruthy()
    expect(new Date(combined!).getHours()).toBe(14)
  })
})
