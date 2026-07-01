import { describe, expect, it } from "vitest"
import {
  combineDateAndTime,
  defaultIntakeScheduleDate,
  defaultIntakeScheduleTime,
  eventsOnScheduleDay,
  findScheduleConflicts,
  formatIntakeScheduleVehicleLine,
  isScheduleDateTimeValid,
  scheduleTimeSlotOptions,
  suggestNextOpenTime,
} from "@/lib/intake-schedule-helpers"
import type { SchedulerEvent } from "@/lib/types"

describe("intake schedule helpers", () => {
  it("builds default date and time", () => {
    const now = new Date(2026, 5, 30, 14, 10, 0, 0)
    expect(defaultIntakeScheduleDate(now)).toBe("2026-06-30")
    expect(defaultIntakeScheduleTime(now)).toBe("14:30")
  })

  it("combines date and time for datetime-local shape", () => {
    expect(combineDateAndTime("2026-06-30", "15:00")).toBe("2026-06-30T15:00")
    expect(combineDateAndTime("", "15:00")).toBe("")
  })

  it("validates schedule datetime", () => {
    expect(isScheduleDateTimeValid("2026-06-30", "15:00")).toBe(true)
    expect(isScheduleDateTimeValid("2026-06-30", "")).toBe(false)
  })

  it("formats vehicle line", () => {
    expect(
      formatIntakeScheduleVehicleLine({
        vehicle_year: "2020",
        vehicle_make: "Ford",
        vehicle_model: "F-150",
      })
    ).toBe("2020 Ford F-150")
    expect(formatIntakeScheduleVehicleLine({})).toBeNull()
  })

  it("lists booked events for a day", () => {
    const events: SchedulerEvent[] = [
      {
        id: "a",
        customer_name: "Allen",
        customer_phone: null,
        location: null,
        summary: null,
        disposition: null,
        scheduled_at: "2026-06-30T13:00:00.000Z",
        scheduled_tentative: false,
        created_at: "2026-06-30T12:00:00.000Z",
        job_type: "Lockout",
        duration_minutes: 60,
        assigned_tech_id: null,
        assigned_tech_name: null,
        vehicle_year: null,
        vehicle_make: null,
        vehicle_model: null,
        job_notes: null,
        latitude: null,
        longitude: null,
        job_status: null,
        dispatch_status: null,
      },
    ]
    const dayEvents = eventsOnScheduleDay(events, "2026-06-30")
    expect(dayEvents).toHaveLength(1)
  })

  it("detects overlapping bookings", () => {
    const startLocal = combineDateAndTime("2026-06-30", "15:00")
    const events: SchedulerEvent[] = [
      {
        id: "booked",
        customer_name: "Bob",
        customer_phone: null,
        location: null,
        summary: null,
        disposition: null,
        scheduled_at: new Date(startLocal).toISOString(),
        scheduled_tentative: false,
        created_at: "2026-06-30T12:00:00.000Z",
        job_type: "Lockout",
        duration_minutes: 60,
        assigned_tech_id: null,
        assigned_tech_name: null,
        vehicle_year: null,
        vehicle_make: null,
        vehicle_model: null,
        job_notes: null,
        latitude: null,
        longitude: null,
        job_status: null,
        dispatch_status: null,
      },
    ]
    const conflicts = findScheduleConflicts(events, "2026-06-30", "15:00", 60, null)
    expect(conflicts.map((c) => c.id)).toContain("booked")
  })

  it("suggests the first open slot", () => {
    const open = suggestNextOpenTime([], "2026-06-30", 60, null)
    expect(open).toBe(scheduleTimeSlotOptions()[0]?.value ?? null)
  })
})
