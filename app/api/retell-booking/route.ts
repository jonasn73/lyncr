// POST /api/retell-booking — Retell AI custom-function + inbound call webhook bridge.
// Supports: call-start dynamic greeting ([dynamic_slot]), slot check, booking confirm,
// and DTMF/voice shortcuts (1/book it → confirm, 2/questions → open conversation).

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { createUnassignedJobFromIntake } from "@/lib/create-intake-job"
import { listOwnerSchedulerEvents } from "@/lib/db"
import { listScheduleBlockouts } from "@/lib/schedule-blockouts-db"
import { defaultIntakeScheduleDate } from "@/lib/intake-schedule-helpers"
import { monthRangeUtc } from "@/lib/scheduler-utils"
import { getNextAvailableSlot } from "@/lib/smart-overflow-autopilot"
import {
  buildRetellInboundGreetingResponse,
  isRetellInboundCallEvent,
  parseRetellBookingPayload,
  routeRetellBookingTool,
  RETELL_DEFAULT_BEGIN_MESSAGE_TEMPLATE,
  type RetellBookingRequestBody,
} from "@/lib/retell-booking"
import type { ScheduleBlockout, SchedulerEvent } from "@/lib/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function retellSecretOk(req: NextRequest): boolean {
  const expected = (process.env.RETELL_WEBHOOK_SECRET || process.env.RETELL_API_KEY || "").trim()
  // Fail closed in production — open only for local/dev when secret is unset.
  if (!expected) {
    return process.env.NODE_ENV !== "production" && process.env.VERCEL_ENV !== "production"
  }
  const auth = req.headers.get("authorization")?.trim() || ""
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : ""
  const headerKey =
    req.headers.get("x-retell-api-key")?.trim() ||
    req.headers.get("x-retell-signature")?.trim() ||
    ""
  return bearer === expected || headerKey === expected
}

function resolveOwnerUserId(req: NextRequest, args: Record<string, unknown>): string | null {
  const fromArgs =
    (typeof args.ownerUserId === "string" && args.ownerUserId.trim()) ||
    (typeof args.userId === "string" && args.userId.trim()) ||
    (typeof args.owner_user_id === "string" && args.owner_user_id.trim()) ||
    ""
  if (fromArgs) return fromArgs
  const fromHeader = req.headers.get("x-lyncr-owner-id")?.trim() || ""
  if (fromHeader) return fromHeader
  const fromEnv = (process.env.RETELL_DEFAULT_OWNER_USER_ID || "").trim()
  if (fromEnv) return fromEnv
  return getUserIdFromRequest(req.headers.get("cookie"))
}

function ownerIdFromInboundBody(body: RetellBookingRequestBody): Record<string, unknown> {
  const meta = body.call?.metadata || {}
  const inbound = body.call_inbound || {}
  return {
    ownerUserId:
      meta.ownerUserId ||
      meta.owner_user_id ||
      meta.userId ||
      inbound.ownerUserId ||
      inbound.owner_user_id ||
      undefined,
  }
}

async function loadMonthEvents(ownerUserId: string): Promise<SchedulerEvent[]> {
  const now = new Date()
  const range = monthRangeUtc(now.getFullYear(), now.getMonth())
  try {
    return await listOwnerSchedulerEvents({
      ownerUserId,
      fromIso: range.from,
      toIso: range.to,
    })
  } catch (e) {
    console.warn("[retell-booking] scheduler list skipped:", e)
    return []
  }
}

async function loadOwnerBlockouts(ownerUserId: string): Promise<ScheduleBlockout[]> {
  const now = new Date()
  const fromDate = defaultIntakeScheduleDate(now)
  const ahead = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 21)
  const toDate = defaultIntakeScheduleDate(ahead)
  try {
    return await listScheduleBlockouts({ ownerUserId, fromDate, toDate })
  } catch (e) {
    console.warn("[retell-booking] blockouts list skipped:", e)
    return []
  }
}

/** GET — live offer snapshot for Smart Overflow Autopilot UI / operators. */
export async function GET(req: NextRequest) {
  if (!retellSecretOk(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const ownerUserId = resolveOwnerUserId(req, {})
  if (!ownerUserId) {
    return NextResponse.json({ error: "ownerUserId required" }, { status: 401 })
  }

  const [events, blockouts] = await Promise.all([
    loadMonthEvents(ownerUserId),
    loadOwnerBlockouts(ownerUserId),
  ])
  const slot = getNextAvailableSlot(new Date(), events, { blockouts })
  const available_slot_raw = slot?.text || "Monday morning at 9:00 AM"
  const greeting = buildRetellInboundGreetingResponse(events, new Date(), RETELL_DEFAULT_BEGIN_MESSAGE_TEMPLATE, blockouts)

  return NextResponse.json({
    data: {
      api: "Active",
      connected_to: "Retell AI",
      connection_label: "API: Active / Connected to Retell AI",
      speech_response: `The next available one-hour service opening is ${available_slot_raw}.`,
      available_slot_raw,
      offering: `Offering: ${available_slot_raw}`,
      scheduled_at_iso: slot?.scheduledAtIso || null,
      begin_message: greeting.call_inbound.agent_override.retell_llm.begin_message,
      dynamic_slot: available_slot_raw,
    },
  })
}

export async function POST(req: NextRequest) {
  if (!retellSecretOk(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: RetellBookingRequestBody = {}
  try {
    body = (await req.json()) as RetellBookingRequestBody
  } catch {
    return NextResponse.json(
      {
        error: "Invalid JSON",
        speech_response: "I could not read that booking request. Please try again.",
      },
      { status: 400 }
    )
  }

  // ── 1) Call-start / inbound webhook → inject [dynamic_slot] into greeting ──
  if (isRetellInboundCallEvent(body)) {
    const ownerUserId = resolveOwnerUserId(req, ownerIdFromInboundBody(body))
    if (!ownerUserId) {
      // Still answer Retell quickly with a soft default so the call is not rejected.
      const fallback = buildRetellInboundGreetingResponse([], new Date())
      return NextResponse.json(fallback)
    }
    const [events, blockouts] = await Promise.all([
      loadMonthEvents(ownerUserId),
      loadOwnerBlockouts(ownerUserId),
    ])
    const greeting = buildRetellInboundGreetingResponse(
      events,
      new Date(),
      RETELL_DEFAULT_BEGIN_MESSAGE_TEMPLATE,
      blockouts
    )
    return NextResponse.json(greeting)
  }

  // ── 2) Custom functions + DTMF / spoken intent shortcuts ──
  const { name, args } = parseRetellBookingPayload(body)
  const ownerUserId = resolveOwnerUserId(req, args)
  if (!ownerUserId) {
    return NextResponse.json(
      {
        error: "ownerUserId required",
        speech_response: "I am missing account context for this calendar. Please hold.",
      },
      { status: 401 }
    )
  }

  const [events, blockouts] = await Promise.all([
    loadMonthEvents(ownerUserId),
    loadOwnerBlockouts(ownerUserId),
  ])
  const routed = routeRetellBookingTool(name, args, events, new Date(), blockouts)

  if ("error" in routed) {
    return NextResponse.json(
      {
        error: routed.error,
        speech_response: routed.speech_response,
        name,
      },
      { status: 400 }
    )
  }

  // Persist confirmed AI bookings into the real hopper when a phone is present.
  let persistedId: string | null = null
  if (routed.tool === "confirm_monday_booking") {
    const phone = routed.appointment.customer_phone?.trim() || ""
    if (phone) {
      try {
        const created = await createUnassignedJobFromIntake({
          ownerUserId,
          callerE164: phone,
          customerName: routed.appointment.customer_name,
          jobType: routed.appointment.job_type,
          notes: routed.appointment.job_notes,
          scheduledAtIso: routed.appointment.scheduled_at,
          pendingCallback: true,
        })
        persistedId = created.lead_id ?? null
      } catch (e) {
        console.warn("[retell-booking] persist confirm_monday_booking failed:", e)
      }
    }
  }

  if (routed.tool === "check_next_available_slot") {
    return NextResponse.json({
      speech_response: routed.speech_response,
      available_slot_raw: routed.available_slot_raw,
      scheduled_at_iso: routed.scheduled_at_iso,
      tool: routed.tool,
      connection_label: "API: Active / Connected to Retell AI",
    })
  }

  if (routed.tool === "start_confirm_monday_booking") {
    return NextResponse.json({
      speech_response: routed.speech_response,
      available_slot_raw: routed.available_slot_raw,
      scheduled_at_iso: routed.scheduled_at_iso,
      tool: routed.tool,
      llm_context_state: routed.llm_context_state,
      next_action: routed.next_action,
      digit: routed.digit ?? null,
      connection_label: "API: Active / Connected to Retell AI",
    })
  }

  if (routed.tool === "open_conversation_mode") {
    return NextResponse.json({
      speech_response: routed.speech_response,
      available_slot_raw: routed.available_slot_raw,
      tool: routed.tool,
      llm_context_state: routed.llm_context_state,
      next_action: routed.next_action,
      digit: "digit" in routed ? routed.digit ?? null : null,
      connection_label: "API: Active / Connected to Retell AI",
    })
  }

  return NextResponse.json({
    speech_response: routed.speech_response,
    available_slot_raw: routed.available_slot_raw,
    tool: routed.tool,
    confirmation_status: "Confirmed by AI",
    appointment: {
      ...routed.appointment,
      id: persistedId || routed.appointment.id,
    },
    persisted: Boolean(persistedId),
    connection_label: "API: Active / Connected to Retell AI",
  })
}
