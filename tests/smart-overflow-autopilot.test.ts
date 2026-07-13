import { describe, expect, it } from "vitest"
import {
  countConfirmedJobsOnDay,
  formatNextAvailableSlotText,
  getNextAvailableSlot,
  isSmartOverflowActive,
  onAICallBookingReceived,
  DEFAULT_SMART_OVERFLOW_CONFIG,
} from "@/lib/smart-overflow-autopilot"
import { combineDateAndTime } from "@/lib/intake-schedule-helpers"
import type { SchedulerEvent } from "@/lib/types"

function eventAt(id: string, localDateTime: string): SchedulerEvent {
  return {
    id,
    customer_name: id,
    customer_phone: null,
    location: null,
    summary: null,
    disposition: "BOOKED",
    scheduled_at: new Date(localDateTime).toISOString(),
    scheduled_tentative: false,
    created_at: new Date(localDateTime).toISOString(),
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
  }
}

describe("smart overflow autopilot", () => {
  it("formats next-slot offer text for today and tomorrow", () => {
    const now = new Date(2026, 6, 13, 8, 0, 0, 0) // Monday Jul 13 2026
    expect(formatNextAvailableSlotText("2026-07-13", "09:00", now)).toBe("Today at 9:00 AM")
    expect(formatNextAvailableSlotText("2026-07-14", "09:00", now)).toBe("Tomorrow at 9:00 AM")
    expect(formatNextAvailableSlotText("2026-07-15", "09:00", now)).toBe("Wednesday morning")
  })

  it("finds the next unassigned 1-hour block from the scheduler array", () => {
    const now = new Date(2026, 6, 13, 8, 0, 0, 0)
    const booked = eventAt("a", combineDateAndTime("2026-07-13", "09:00"))
    const slot = getNextAvailableSlot(now, [booked])
    expect(slot).not.toBeNull()
    expect(slot?.dateKey).toBe("2026-07-13")
    expect(slot?.timeValue).not.toBe("09:00")
    expect(slot?.text).toMatch(/Today at/)
  })

  it("activates Manual Toggle and Auto-On Full Capacity correctly", () => {
    expect(
      isSmartOverflowActive({ ...DEFAULT_SMART_OVERFLOW_CONFIG, manualEnabled: true }, 0)
    ).toBe(true)
    expect(
      isSmartOverflowActive(
        { mode: "auto_capacity", manualEnabled: false, capacityThreshold: 5 },
        6
      )
    ).toBe(true)
    expect(
      isSmartOverflowActive(
        { mode: "auto_capacity", manualEnabled: false, capacityThreshold: 5 },
        5
      )
    ).toBe(false)
  })

  it("counts confirmed jobs on a day", () => {
    const events = [
      eventAt("a", combineDateAndTime("2026-07-13", "09:00")),
      eventAt("b", combineDateAndTime("2026-07-13", "11:00")),
      eventAt("c", combineDateAndTime("2026-07-14", "09:00")),
    ]
    expect(countConfirmedJobsOnDay(events, "2026-07-13")).toBe(2)
  })

  it("onAICallBookingReceived appends a pool schema block into the scheduler array", () => {
    const now = new Date(2026, 6, 13, 8, 0, 0, 0)
    const { poolEntry, nextEvents, nextAvailableSlotText } = onAICallBookingReceived(
      { callerPhone: "+15025550100", customerName: "Pat", jobType: "Lockout" },
      [],
      now
    )
    expect(poolEntry.source).toBe("smart_overflow_ai_booking")
    expect(poolEntry.dispatch_status).toBe("unassigned_pool")
    expect(poolEntry.customer_name).toBe("Pat")
    expect(nextEvents).toHaveLength(1)
    expect(nextAvailableSlotText.length).toBeGreaterThan(0)
  })
})
