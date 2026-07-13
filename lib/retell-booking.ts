// Retell AI custom-function + inbound webhook helpers.
// Tools: slot check, Monday booking confirm, DTMF/voice intent shortcuts, call-start greeting.

import {
  getNextAvailableSlot,
  onAICallBookingReceived,
  type SmartOverflowPoolSchemaBlock,
} from "@/lib/smart-overflow-autopilot"
import type { SchedulerEvent } from "@/lib/types"

/** Tools Retell agents may invoke via POST /api/retell-booking. */
export type RetellBookingToolName =
  | "check_next_available_slot"
  | "confirm_monday_booking"
  | "handle_caller_intent"
  | "open_conversation_mode"

/** LLM / agent conversation modes returned to Retell after DTMF or spoken shortcuts. */
export type RetellLlmContextState =
  | "confirm_monday_booking_collect"
  | "open_conversation"
  | "offer_slot"

export type RetellBookingRequestBody = {
  name?: string
  args?: Record<string, unknown> | null
  /** Some Retell payloads nest the tool call. */
  tool_name?: string
  tool_call_id?: string
  /** Agent / account webhook events (call_started, call_ended, …). */
  event?: string
  /** Inbound number webhook often nests under call_inbound or sends flat call fields. */
  call_inbound?: Record<string, unknown>
  from_number?: string
  to_number?: string
  agent_id?: string
  call?: {
    call_id?: string
    from_number?: string
    to_number?: string
    direction?: string
    metadata?: Record<string, unknown>
    retell_llm_dynamic_variables?: Record<string, string>
  }
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

export type OpenConversationToolResult = {
  speech_response: string
  available_slot_raw: string
  tool: "open_conversation_mode"
  llm_context_state: "open_conversation"
  next_action: "open_conversation"
}

export type IntentShortcutResult =
  | {
      tool: "start_confirm_monday_booking"
      speech_response: string
      available_slot_raw: string
      scheduled_at_iso: string | null
      llm_context_state: "confirm_monday_booking_collect"
      next_action: "confirm_monday_booking_collect"
      digit?: string
    }
  | OpenConversationToolResult & { digit?: string }

/** Retell inbound webhook response — injects {{dynamic_slot}} / [dynamic_slot] into the greeting. */
export type RetellInboundGreetingResponse = {
  call_inbound: {
    dynamic_variables: {
      dynamic_slot: string
      available_slot_raw: string
      scheduled_at_iso: string
    }
    metadata: {
      lyncr_offer_slot: string
      lyncr_scheduled_at_iso: string
      source: "smart_overflow_retell"
    }
    agent_override: {
      retell_llm: {
        begin_message: string
        /** Soft nudge so the LLM knows DTMF 1/2 and book-it phrases are valid. */
        general_prompt?: string
      }
    }
  }
  speech_response: string
  available_slot_raw: string
  connection_label: string
}

/** Default begin message template — `[dynamic_slot]` is replaced with the live offer. */
export const RETELL_DEFAULT_BEGIN_MESSAGE_TEMPLATE =
  "Thanks for calling. Our next available one-hour service opening is [dynamic_slot]. " +
  "Press 1 or say book it to reserve that slot, or press 2 if you have questions about pricing, location, or lock services."

const BOOK_IT_PHRASES = [
  "book it",
  "book that",
  "yes",
  "yeah",
  "yep",
  "sure",
  "sounds good",
  "that works",
  "i'll take it",
  "ill take it",
  "confirm",
  "schedule it",
  "reserve it",
]

const AGENT_QUESTION_PHRASES = [
  "talk to agent",
  "talk to a person",
  "talk to someone",
  "questions",
  "i have a question",
  "i have questions",
  "pricing",
  "how much",
  "where are you",
  "location",
  "lockout",
  "lock services",
  "speak to someone",
  "human",
  "operator",
]

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

/**
 * True when this POST is Retell's inbound-number / call-start webhook
 * (not a custom function tool call).
 */
export function isRetellInboundCallEvent(body: RetellBookingRequestBody): boolean {
  const event = asString(body.event).toLowerCase()
  if (event === "call_started" || event === "call_inbound" || event === "inbound_call") {
    return true
  }
  if (body.call_inbound && typeof body.call_inbound === "object") return true
  // Flat inbound webhook: has telephony numbers but no custom-function name.
  const hasNumbers = Boolean(
    asString(body.from_number) ||
      asString(body.to_number) ||
      asString(body.call?.from_number) ||
      asString(body.call?.to_number)
  )
  const hasToolName = Boolean(asString(body.name || body.tool_name))
  if (hasNumbers && !hasToolName && body.call?.direction === "inbound") return true
  // Explicit marker some setups send when wiring the inbound webhook URL.
  if (asString((body as { type?: string }).type).toLowerCase() === "inbound_webhook") return true
  return false
}

/** Replace `[dynamic_slot]` and `{{dynamic_slot}}` placeholders with the live offer text. */
export function injectDynamicSlotGreeting(
  template: string,
  availableSlotRaw: string
): string {
  const slot = availableSlotRaw.trim() || "Monday morning at 9:00 AM"
  return template
    .replaceAll("[dynamic_slot]", slot)
    .replaceAll("{{dynamic_slot}}", slot)
    .replaceAll("{{available_slot_raw}}", slot)
}

/**
 * Build Retell's inbound webhook override payload with the next calendar opening injected.
 */
export function buildRetellInboundGreetingResponse(
  events: readonly SchedulerEvent[],
  now = new Date(),
  beginMessageTemplate = RETELL_DEFAULT_BEGIN_MESSAGE_TEMPLATE
): RetellInboundGreetingResponse {
  const slot = getNextAvailableSlot(now, events)
  const available_slot_raw = slot?.text || "Monday morning at 9:00 AM"
  const scheduled_at_iso = slot?.scheduledAtIso || ""
  const begin_message = injectDynamicSlotGreeting(beginMessageTemplate, available_slot_raw)

  return {
    call_inbound: {
      dynamic_variables: {
        dynamic_slot: available_slot_raw,
        available_slot_raw,
        scheduled_at_iso,
      },
      metadata: {
        lyncr_offer_slot: available_slot_raw,
        lyncr_scheduled_at_iso: scheduled_at_iso,
        source: "smart_overflow_retell",
      },
      agent_override: {
        retell_llm: {
          begin_message,
          general_prompt:
            "You are Lyncr Smart Overflow. The next open service slot is {{dynamic_slot}}. " +
            "If the caller presses 1 or says book it / yes, collect name, phone, and job type then call confirm_monday_booking. " +
            "If they press 2 or ask questions / talk to agent, switch to open conversation about pricing, location, and lock services.",
        },
      },
    },
    speech_response: begin_message,
    available_slot_raw,
    connection_label: "API: Active / Connected to Retell AI",
  }
}

/** Classify DTMF digit (1/2) or spoken phrase into booking vs open-conversation. */
export function classifyCallerIntent(input: {
  digit?: string | null
  utterance?: string | null
}): "book" | "open_conversation" | "unknown" {
  const digit = asString(input.digit).replace(/\D/g, "")
  if (digit === "1") return "book"
  if (digit === "2") return "open_conversation"

  const utterance = asString(input.utterance).toLowerCase()
  if (!utterance) return "unknown"

  if (BOOK_IT_PHRASES.some((p) => utterance === p || utterance.includes(p))) return "book"
  if (AGENT_QUESTION_PHRASES.some((p) => utterance === p || utterance.includes(p))) {
    return "open_conversation"
  }
  return "unknown"
}

function extractIntentSignals(args: Record<string, unknown>): {
  digit: string
  utterance: string
} {
  const digit =
    asString(args.digit) ||
    asString(args.dtmf) ||
    asString(args.pressed) ||
    asString(args.key) ||
    asString(args.dtmf_digit)
  const utterance =
    asString(args.utterance) ||
    asString(args.transcript) ||
    asString(args.text) ||
    asString(args.speech) ||
    asString(args.intent) ||
    asString(args.phrase)
  return { digit, utterance }
}

/**
 * DTMF + spoken shortcut router.
 * 1 / "book it" / "yes" → begin confirm_monday_booking collection.
 * 2 / "talk to agent" / "questions" → open conversation mode.
 */
export function handleCallerIntentShortcut(
  args: Record<string, unknown>,
  events: readonly SchedulerEvent[],
  now = new Date()
): IntentShortcutResult | { error: string; speech_response: string } {
  const { digit, utterance } = extractIntentSignals(args)
  const intent = classifyCallerIntent({ digit, utterance })
  const slot = handleCheckNextAvailableSlot(events, now)

  if (intent === "book") {
    return {
      tool: "start_confirm_monday_booking",
      digit: digit || undefined,
      available_slot_raw: slot.available_slot_raw,
      scheduled_at_iso: slot.scheduled_at_iso,
      llm_context_state: "confirm_monday_booking_collect",
      next_action: "confirm_monday_booking_collect",
      speech_response:
        `Great — I'll book you for ${slot.available_slot_raw}. ` +
        `What's your name, and what phone number should we use for the appointment?`,
    }
  }

  if (intent === "open_conversation") {
    return {
      tool: "open_conversation_mode",
      digit: digit || undefined,
      available_slot_raw: slot.available_slot_raw,
      llm_context_state: "open_conversation",
      next_action: "open_conversation",
      speech_response:
        "Of course — I can help with pricing, location, and lock services. What would you like to know?",
    }
  }

  return {
    error: "Unrecognized DTMF or utterance",
    speech_response:
      `I didn't catch that. Our next opening is ${slot.available_slot_raw}. ` +
      `Press 1 or say book it to reserve it, or press 2 for questions.`,
  }
}

export function handleOpenConversationMode(
  events: readonly SchedulerEvent[],
  now = new Date()
): OpenConversationToolResult {
  const slot = handleCheckNextAvailableSlot(events, now)
  return {
    tool: "open_conversation_mode",
    available_slot_raw: slot.available_slot_raw,
    llm_context_state: "open_conversation",
    next_action: "open_conversation",
    speech_response:
      "Sure — ask me anything about pricing, our service area, or lock services. " +
      `When you're ready, I can still book ${slot.available_slot_raw} for you.`,
  }
}

export function isRetellBookingToolName(name: string): name is RetellBookingToolName {
  return (
    name === "check_next_available_slot" ||
    name === "confirm_monday_booking" ||
    name === "handle_caller_intent" ||
    name === "open_conversation_mode"
  )
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

/** Route a Retell tool name (or bare DTMF args) to the matching Smart Overflow handler. */
export function routeRetellBookingTool(
  name: string,
  args: Record<string, unknown>,
  events: readonly SchedulerEvent[],
  now = new Date()
):
  | CheckSlotToolResult
  | ConfirmBookingToolResult
  | IntentShortcutResult
  | OpenConversationToolResult
  | { error: string; speech_response: string } {
  const { digit, utterance } = extractIntentSignals(args)

  // Bare DTMF / spoken shortcut with no explicit tool name → intent router.
  if (!name && (digit || utterance)) {
    return handleCallerIntentShortcut(args, events, now)
  }

  switch (name) {
    case "check_next_available_slot":
      return handleCheckNextAvailableSlot(events, now)
    case "confirm_monday_booking":
      return handleConfirmMondayBooking(args, events, now)
    case "handle_caller_intent":
    case "dtmf":
    case "dtmf_pressed":
      return handleCallerIntentShortcut(args, events, now)
    case "open_conversation_mode":
      return handleOpenConversationMode(events, now)
    default:
      // If the custom function name is unknown but digit/utterance is present, still route.
      if (digit || utterance) {
        return handleCallerIntentShortcut(args, events, now)
      }
      return {
        error: `Unknown Retell tool: ${name || "(missing)"}`,
        speech_response:
          "I'm having trouble checking the calendar right now. Please hold while I get someone to help.",
      }
  }
}
