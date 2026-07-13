// Retell AI custom-function tool routing — check slots + confirm Monday bookings.

import {
  getNextAvailableSlot,
  onAICallBookingReceived,
  type SmartOverflowPoolSchemaBlock,
} from "@/lib/smart-overflow-autopilot"
import type { SchedulerEvent } from "@/lib/types"

/** Tools Retell agents may invoke via POST /api/retell-booking. */
export type RetellBookingToolName = "check_next_available_slot" | "confirm_monday_booking"

export type RetellBookingRequestBody = {
  name?: string
  args?: Record<string, unknown> | null
  /** Some Retell payloads nest the tool call. */
  tool_name?: string
  tool_call_id?: string
  call?: { call_id?: string; metadata?: Record<string, unknown> }
}

export type CheckSlotToolResult = {
  speech_response: string
  available_slot_raw: string
  scheduled_at_iso: string | null
  tool: "check_next_available_slot"
}

export type ConfirmBookingToolResult = {
  speech_response: string
  available_slot_raw: string
  appointment: SmartOverflowPoolSchemaBlock & { confirmation_status: "Confirmed by AI" }
  tool: "confirm_monday_booking"
  nextEvents: SchedulerEvent[]
}

function asString(value: unknown): string {
  if (typeof value === "string") return value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return ""
}

/** Normalize Retell `{ name, args }` (and a few alternate shapes) into tool + args. */
export function parseRetellBookingPayload(body: RetellBookingRequestBody): {
  name: string
  args: Record<string, unknown>
} {
  const name = asString(body.name || body.tool_name).toLowerCase()
  const args =
    body.args && typeof body.args === "object" && !Array.isArray(body.args)
      ? body.args
      : {}
  return { name, args }
}

export function isRetellBookingToolName(name: string): name is RetellBookingToolName {
  return name === "check_next_available_slot" || name === "confirm_monday_booking"
}

/**
 * Tool 1 — query scheduler state for the next unassigned 1-hour opening.
 */
export function handleCheckNextAvailableSlot(
  events: readonly SchedulerEvent[],
  now = new Date()
): CheckSlotToolResult {
  const slot = getNextAvailableSlot(now, events)
  const available_slot_raw = slot?.text || "Monday morning at 9:00 AM"
  const speech_response = `The next available one-hour service opening is ${available_slot_raw}. Would you like me to book that for you?`
  return {
    tool: "check_next_available_slot",
    speech_response,
    available_slot_raw,
    scheduled_at_iso: slot?.scheduledAtIso || null,
  }
}

/**
 * Tool 2 — confirm booking from voice transcript args and append into scheduler state.
 */
export function handleConfirmMondayBooking(
  args: Record<string, unknown>,
  events: readonly SchedulerEvent[],
  now = new Date()
): ConfirmBookingToolResult {
  const customerName =
    asString(args.customerName) ||
    asString(args.customer_name) ||
    asString(args.name) ||
    "Caller"
  const customerPhone =
    asString(args.customerPhone) ||
    asString(args.customer_phone) ||
    asString(args.phone) ||
    asString(args.callerPhone)
  const jobType =
    asString(args.jobType) || asString(args.job_type) || asString(args.service) || "Service call"

  const check = handleCheckNextAvailableSlot(events, now)
  const booked = onAICallBookingReceived(
    {
      customerName,
      callerPhone: customerPhone || null,
      jobType,
      notes: "Confirmed by AI · Retell custom function confirm_monday_booking",
      scheduledAtIso: check.scheduled_at_iso,
      nextAvailableSlotText: check.available_slot_raw,
    },
    events,
    now
  )

  const appointment = {
    ...booked.poolEntry,
    summary: `Confirmed by AI · ${check.available_slot_raw}`,
    job_notes: `Confirmed by AI via Retell · ${check.available_slot_raw}`,
    confirmation_status: "Confirmed by AI" as const,
  }

  return {
    tool: "confirm_monday_booking",
    speech_response: `You're all set. I've booked ${customerName} for ${check.available_slot_raw}. A technician will follow up shortly.`,
    available_slot_raw: check.available_slot_raw,
    appointment,
    nextEvents: booked.nextEvents,
  }
}

/** Route a Retell tool name to the matching Smart Overflow handler. */
export function routeRetellBookingTool(
  name: string,
  args: Record<string, unknown>,
  events: readonly SchedulerEvent[],
  now = new Date()
): CheckSlotToolResult | ConfirmBookingToolResult | { error: string; speech_response: string } {
  switch (name) {
    case "check_next_available_slot":
      return handleCheckNextAvailableSlot(events, now)
    case "confirm_monday_booking":
      return handleConfirmMondayBooking(args, events, now)
    default:
      return {
        error: `Unknown Retell tool: ${name || "(missing)"}`,
        speech_response:
          "I'm having trouble checking the calendar right now. Please hold while I get someone to help.",
      }
  }
}
