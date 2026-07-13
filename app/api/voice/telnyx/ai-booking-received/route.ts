// POST /api/voice/telnyx/ai-booking-received
// Mock listener stub — when the voice bot finishes an automated booking loop,
// construct a Scheduler pool entry (hopper job) via createUnassignedJobFromIntake.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { createUnassignedJobFromIntake } from "@/lib/create-intake-job"
import { listOwnerSchedulerEvents } from "@/lib/db"
import { monthRangeUtc } from "@/lib/scheduler-utils"
import {
  getNextAvailableSlot,
  onAICallBookingReceived,
  type AICallBookingReceivedPayload,
} from "@/lib/smart-overflow-autopilot"
import type { SchedulerEvent } from "@/lib/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

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
    console.warn("[ai-booking-received] scheduler list skipped:", e)
    return []
  }
}

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: AICallBookingReceivedPayload = {}
  try {
    body = (await req.json()) as AICallBookingReceivedPayload
  } catch {
    body = {}
  }

  const now = new Date()
  const events = await loadMonthEvents(userId)
  const slot = getNextAvailableSlot(now, events)
  const local = onAICallBookingReceived(
    {
      ...body,
      scheduledAtIso: body.scheduledAtIso || slot?.scheduledAtIso || null,
      nextAvailableSlotText: body.nextAvailableSlotText || slot?.text || null,
    },
    events,
    now
  )

  // Best-effort persist into the real hopper when we have a callable phone.
  let persistedId: string | null = null
  const phone = (body.callerPhone || "").trim()
  if (phone) {
    try {
      const created = await createUnassignedJobFromIntake({
        ownerUserId: userId,
        callerE164: phone,
        customerName: body.customerName || local.poolEntry.customer_name,
        jobType: body.jobType || local.poolEntry.job_type,
        notes: body.notes || local.poolEntry.job_notes,
        scheduledAtIso: local.poolEntry.scheduled_at,
        pendingCallback: true,
      })
      persistedId = created.lead_id ?? null
    } catch (e) {
      console.warn("[ai-booking-received] createUnassignedJobFromIntake stub failed:", e)
    }
  }

  return NextResponse.json({
    data: {
      poolEntry: {
        ...local.poolEntry,
        id: persistedId || local.poolEntry.id,
      },
      nextAvailableSlotText: local.nextAvailableSlotText,
      offering: `Offering: ${local.nextAvailableSlotText}`,
      persisted: Boolean(persistedId),
    },
  })
}

/** GET — capacity snapshot for routing UI / outbound phone webhook copy. */
export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const now = new Date()
  const events = await loadMonthEvents(userId)
  const slot = getNextAvailableSlot(now, events)
  return NextResponse.json({
    data: {
      nextAvailableSlotText: slot?.text ?? "Monday morning",
      scheduledAtIso: slot?.scheduledAtIso || null,
      offering: `Offering: ${slot?.text ?? "Monday morning"}`,
    },
  })
}
