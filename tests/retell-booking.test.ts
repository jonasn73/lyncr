import { describe, expect, it } from "vitest"
import {
  buildRetellInboundGreetingResponse,
  classifyCallerIntent,
  handleCallerIntentShortcut,
  handleCheckNextAvailableSlot,
  handleConfirmMondayBooking,
  injectDynamicSlotGreeting,
  isRetellInboundCallEvent,
  parseRetellBookingPayload,
  routeRetellBookingTool,
  RETELL_DEFAULT_BEGIN_MESSAGE_TEMPLATE,
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

  it("injects [dynamic_slot] into the inbound begin message", () => {
    const text = injectDynamicSlotGreeting(
      RETELL_DEFAULT_BEGIN_MESSAGE_TEMPLATE,
      "Monday morning at 9:00 AM"
    )
    expect(text).toContain("Monday morning at 9:00 AM")
    expect(text).not.toContain("[dynamic_slot]")
  })

  it("builds Retell call_inbound greeting override with dynamic_variables", () => {
    const now = new Date(2026, 6, 13, 8, 0, 0, 0)
    const greeting = buildRetellInboundGreetingResponse([], now)
    expect(greeting.call_inbound.dynamic_variables.dynamic_slot).toBeTruthy()
    expect(greeting.call_inbound.agent_override.retell_llm.begin_message).toContain(
      greeting.available_slot_raw
    )
    expect(greeting.call_inbound.agent_override.retell_llm.begin_message).not.toContain(
      "[dynamic_slot]"
    )
  })

  it("detects inbound call webhook events", () => {
    expect(isRetellInboundCallEvent({ event: "call_started" })).toBe(true)
    expect(isRetellInboundCallEvent({ call_inbound: { from_number: "+1" } })).toBe(true)
    expect(
      isRetellInboundCallEvent({ name: "check_next_available_slot", args: {} })
    ).toBe(false)
  })

  it("classifies DTMF 1 / book it as book and 2 / questions as open conversation", () => {
    expect(classifyCallerIntent({ digit: "1" })).toBe("book")
    expect(classifyCallerIntent({ utterance: "yes book it" })).toBe("book")
    expect(classifyCallerIntent({ digit: "2" })).toBe("open_conversation")
    expect(classifyCallerIntent({ utterance: "I have questions about pricing" })).toBe(
      "open_conversation"
    )
  })

  it("handle_caller_intent routes digit 1 into confirm collection state", () => {
    const now = new Date(2026, 6, 13, 8, 0, 0, 0)
    const result = handleCallerIntentShortcut({ digit: "1" }, [], now)
    expect("error" in result).toBe(false)
    if ("error" in result) return
    expect(result.tool).toBe("start_confirm_monday_booking")
    expect(result.llm_context_state).toBe("confirm_monday_booking_collect")
  })

  it("handle_caller_intent routes digit 2 into open conversation mode", () => {
    const now = new Date(2026, 6, 13, 8, 0, 0, 0)
    const result = handleCallerIntentShortcut({ digit: "2" }, [], now)
    expect("error" in result).toBe(false)
    if ("error" in result) return
    expect(result.tool).toBe("open_conversation_mode")
    expect(result.llm_context_state).toBe("open_conversation")
  })
})
