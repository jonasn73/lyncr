import { describe, expect, it } from "vitest"
import {
  handleCheckNextAvailableSlot,
  handleConfirmMondayBooking,
  parseRetellBookingPayload,
  routeRetellBookingTool,
} from "@/lib/retell-booking"
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

describe("retell booking tools", () => {
  it("parses Retell { name, args } payloads", () => {
    const parsed = parseRetellBookingPayload({
      name: "check_next_available_slot",
      args: { ownerUserId: "u1" },
    })
    expect(parsed.name).toBe("check_next_available_slot")
    expect(parsed.args.ownerUserId).toBe("u1")
  })

  it("returns speech_response and available_slot_raw for check_next_available_slot", () => {
    const now = new Date(2026, 6, 13, 8, 0, 0, 0)
    const result = handleCheckNextAvailableSlot([], now)
    expect(result.tool).toBe("check_next_available_slot")
    expect(result.available_slot_raw.length).toBeGreaterThan(0)
    expect(result.speech_response).toContain(result.available_slot_raw)
  })

  it("confirm_monday_booking appends a Confirmed by AI appointment", () => {
    const now = new Date(2026, 6, 13, 8, 0, 0, 0)
    const existing = [eventAt("busy", combineDateAndTime("2026-07-13", "09:00"))]
    const result = handleConfirmMondayBooking(
      {
        customerName: "Alex",
        customerPhone: "+15025550199",
        jobType: "Lockout",
      },
      existing,
      now
    )
    expect(result.tool).toBe("confirm_monday_booking")
    expect(result.appointment.confirmation_status).toBe("Confirmed by AI")
    expect(result.appointment.customer_name).toBe("Alex")
    expect(result.nextEvents.length).toBe(existing.length + 1)
    expect(result.speech_response.toLowerCase()).toContain("booked")
  })

  it("routes unknown tools to a speech fallback error", () => {
    const routed = routeRetellBookingTool("do_something_else", {}, [])
    expect("error" in routed).toBe(true)
  })
})
