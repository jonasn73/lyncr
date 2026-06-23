// ============================================
// PATCH /api/owner/scheduler/[id]
// ============================================
// Owner reschedules a job (scheduled_at only) or edits full job details from the drawer.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  isReasonablePstnDialString,
  listFieldTechnicians,
  normalizePhoneNumberE164,
  setLeadCoordinates,
  updateLeadScheduledAt,
  updateOwnerSchedulerJob,
} from "@/lib/db"
import { geocodeAddress } from "@/lib/geocode"
import type { SchedulerEvent } from "@/lib/types"

export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ id: string }> }

type PatchSchedulerBody = {
  scheduled_at?: string | null
  customer_name?: string
  customer_phone?: string
  job_type?: string
  duration_minutes?: number
  assigned_tech_id?: string | null
  vehicle_year?: string | null
  vehicle_make?: string | null
  vehicle_model?: string | null
  job_address?: string | null
  job_notes?: string | null
}

function isFullJobEdit(body: PatchSchedulerBody): boolean {
  return (
    body.customer_name != null ||
    body.customer_phone != null ||
    body.job_type != null ||
    body.duration_minutes != null ||
    body.assigned_tech_id !== undefined ||
    body.vehicle_year !== undefined ||
    body.vehicle_make !== undefined ||
    body.vehicle_model !== undefined ||
    body.job_address !== undefined ||
    body.job_notes !== undefined
  )
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const { id: leadId } = await context.params
  if (!leadId?.trim()) return NextResponse.json({ error: "Missing lead id" }, { status: 400 })

  const body = (await req.json().catch(() => ({}))) as PatchSchedulerBody

  if (!isFullJobEdit(body)) {
    const raw = body.scheduled_at
    if (raw == null || String(raw).trim() === "") {
      return NextResponse.json({ error: "scheduled_at is required" }, { status: 400 })
    }
    const parsed = Date.parse(String(raw))
    if (Number.isNaN(parsed)) {
      return NextResponse.json({ error: "scheduled_at must be a valid ISO date" }, { status: 400 })
    }
    const scheduledAt = new Date(parsed).toISOString()

    try {
      const ok = await updateLeadScheduledAt(userId, leadId.trim(), scheduledAt)
      if (!ok) return NextResponse.json({ error: "Job not found" }, { status: 404 })
      return NextResponse.json({ data: { id: leadId, scheduled_at: scheduledAt } })
    } catch (e) {
      console.error("[PATCH /api/owner/scheduler/[id]] reschedule", e)
      return NextResponse.json({ error: "Failed to reschedule" }, { status: 500 })
    }
  }

  const customerName = String(body.customer_name ?? "").trim()
  const customerPhoneRaw = String(body.customer_phone ?? "").trim()
  const jobType = String(body.job_type ?? "Other").trim() || "Other"

  if (!customerName) {
    return NextResponse.json({ error: "Customer name is required" }, { status: 400 })
  }
  if (!customerPhoneRaw) {
    return NextResponse.json({ error: "Customer phone is required" }, { status: 400 })
  }

  const customerPhoneE164 = normalizePhoneNumberE164(customerPhoneRaw)
  if (!isReasonablePstnDialString(customerPhoneE164)) {
    return NextResponse.json({ error: "Enter a valid phone number" }, { status: 400 })
  }

  let scheduledAtIso: string | null = null
  if (body.scheduled_at != null && String(body.scheduled_at).trim() !== "") {
    const parsed = Date.parse(String(body.scheduled_at))
    if (Number.isNaN(parsed)) {
      return NextResponse.json({ error: "scheduled_at must be a valid ISO date" }, { status: 400 })
    }
    scheduledAtIso = new Date(parsed).toISOString()
  }

  const assignedTechId = body.assigned_tech_id !== undefined ? body.assigned_tech_id?.trim() || null : undefined
  let assignedTechName: string | null | undefined = undefined
  if (assignedTechId !== undefined) {
    if (assignedTechId) {
      const roster = await listFieldTechnicians(userId)
      const match = roster.find((t) => t.portal_user_id === assignedTechId)
      if (!match?.portal_user_id) {
        return NextResponse.json({ error: "Selected technician is not available" }, { status: 400 })
      }
      assignedTechName = match.name
    } else {
      assignedTechName = null
    }
  }

  try {
    let event = await updateOwnerSchedulerJob({
      ownerUserId: userId,
      leadId: leadId.trim(),
      customerName,
      customerPhoneE164,
      jobType,
      scheduledAtIso,
      durationMinutes: body.duration_minutes,
      assignedTechPortalUserId: assignedTechId,
      assignedTechName,
      vehicleYear: body.vehicle_year ?? null,
      vehicleMake: body.vehicle_make ?? null,
      vehicleModel: body.vehicle_model ?? null,
      jobAddress: body.job_address,
      jobNotes: body.job_notes,
    })

    if (!event) return NextResponse.json({ error: "Job not found" }, { status: 404 })

    const address = body.job_address?.trim()
    if (address && address.length >= 5) {
      const coords = await geocodeAddress(address)
      if (coords) {
        try {
          await setLeadCoordinates(event.id, coords.lat, coords.lng)
          event = { ...event, latitude: coords.lat, longitude: coords.lng } satisfies SchedulerEvent
        } catch (geoErr) {
          console.warn("[PATCH /api/owner/scheduler/[id]] geocode persist skipped:", geoErr)
        }
      }
    }

    return NextResponse.json({ data: { event } })
  } catch (e) {
    console.error("[PATCH /api/owner/scheduler/[id]] update", e)
    return NextResponse.json({ error: "Failed to update job" }, { status: 500 })
  }
}
