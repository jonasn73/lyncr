// POST /api/retell-booking — Retell AI custom-function webhook bridge.
// Expects `{ name, args }` and routes check_next_available_slot | confirm_monday_booking.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { createUnassignedJobFromIntake } from "@/lib/create-intake-job"
import { listOwnerSchedulerEvents } from "@/lib/db"
import { monthRangeUtc } from "@/lib/scheduler-utils"
import { getNextAvailableSlot } from "@/lib/smart-overflow-autopilot"
import {
  parseRetellBookingPayload,
  routeRetellBookingTool,
  type RetellBookingRequestBody,
} from "@/lib/retell-booking"
import type { SchedulerEvent } from "@/lib/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function retellSecretOk(req: NextRequest): boolean {
  const expected = (process.env.RETELL_WEBHOOK_SECRET || process.env.RETELL_API_KEY || "").trim()
  if (!expected) return true // Open when unset (dev / first wire-up); set secret in production.
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

/** GET — live offer snapshot for Smart Overflow Autopilot UI / operators. */
export async function GET(req: NextRequest) {
  if (!retellSecretOk(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const ownerUserId = resolveOwnerUserId(req, {})
  if (!ownerUserId) {
    return NextResponse.json({ error: "ownerUserId required" }, { status: 401 })
  }

  const events = await loadMonthEvents(ownerUserId)
  const slot = getNextAvailableSlot(new Date(), events)
  const available_slot_raw = slot?.text || "Monday morning at 9:00 AM"

  return NextResponse.json({
    data: {
      api: "Active",
      connected_to: "Retell AI",
      connection_label: "API: Active / Connected to Retell AI",
      speech_response: `The next available one-hour service opening is ${available_slot_raw}.`,
      available_slot_raw,
      offering: `Offering: ${available_slot_raw}`,
      scheduled_at_iso: slot?.scheduledAtIso || null,
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

  const events = await loadMonthEvents(ownerUserId)
  const routed = routeRetellBookingTool(name, args, events, new Date())

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
