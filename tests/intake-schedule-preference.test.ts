import { describe, expect, it } from "vitest"
import {
  buildIntakeScheduleCollectedExtras,
  formatIntakeScheduleSummary,
  isIntakeSchedulePreferenceReady,
  normalizeIntakeScheduleFields,
} from "@/lib/intake-schedule-preference"

describe("intake schedule preference", () => {
  it("treats ASAP as ready without a window", () => {
    expect(
      isIntakeSchedulePreferenceReady({
        scheduleUrgency: "asap",
        scheduledDate: "",
        scheduledTime: "",
        availabilityFrom: "",
        availabilityTo: "",
      })
    ).toBe(true)
  })

  it("requires a valid From–To window for Schedule", () => {
    expect(
      isIntakeSchedulePreferenceReady({
        scheduleUrgency: "window",
        scheduledDate: "2026-08-16",
        scheduledTime: "13:00",
        availabilityFrom: "13:00",
        availabilityTo: "17:00",
      })
    ).toBe(true)
    expect(
      isIntakeSchedulePreferenceReady({
        scheduleUrgency: "window",
        scheduledDate: "2026-08-16",
        scheduledTime: "13:00",
        availabilityFrom: "17:00",
        availabilityTo: "13:00",
      })
    ).toBe(false)
  })

  it("still accepts legacy exact date + time", () => {
    expect(
      isIntakeSchedulePreferenceReady({
        scheduleUrgency: "",
        scheduledDate: "2026-08-16",
        scheduledTime: "14:30",
        availabilityFrom: "",
        availabilityTo: "",
      })
    ).toBe(true)
  })

  it("labels ASAP and windows without inventing a pin", () => {
    expect(
      formatIntakeScheduleSummary({
        scheduleUrgency: "asap",
        scheduledDate: "",
        scheduledTime: "",
        availabilityFrom: "",
        availabilityTo: "",
      })
    ).toBe("ASAP / emergency")
    expect(
      formatIntakeScheduleSummary({
        scheduleUrgency: "window",
        scheduledDate: "2026-08-16",
        scheduledTime: "13:00",
        availabilityFrom: "13:00",
        availabilityTo: "17:00",
      })
    ).toMatch(/1:00 PM–5:00 PM/)
  })

  it("builds collected extras like public /book", () => {
    const asap = buildIntakeScheduleCollectedExtras({
      scheduleUrgency: "asap",
      scheduledDate: "",
      scheduledTime: "",
      availabilityFrom: "",
      availabilityTo: "",
    })
    expect(asap?.is_asap).toBe(true)
    expect(asap?.availability_label).toBe("ASAP / emergency")

    const window = buildIntakeScheduleCollectedExtras({
      scheduleUrgency: "window",
      scheduledDate: "2026-08-16",
      scheduledTime: "13:00",
      availabilityFrom: "13:00",
      availabilityTo: "17:00",
    })
    expect(window?.is_asap).toBe(false)
    expect(window?.availability_from).toBe("13:00")
    expect(window?.availability_to).toBe("17:00")
  })

  it("normalizes legacy drafts into a window", () => {
    const normalized = normalizeIntakeScheduleFields({
      scheduledDate: "2026-08-16",
      scheduledTime: "14:00",
    })
    expect(normalized.scheduleUrgency).toBe("window")
    expect(normalized.availabilityFrom).toBe("14:00")
  })
})
