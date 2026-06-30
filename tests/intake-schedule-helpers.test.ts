import { describe, expect, it } from "vitest"
import {
  combineDateAndTime,
  defaultIntakeScheduleDate,
  defaultIntakeScheduleTime,
  formatIntakeScheduleVehicleLine,
  isScheduleDateTimeValid,
} from "@/lib/intake-schedule-helpers"

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
})
