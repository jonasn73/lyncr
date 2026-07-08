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
  deleteOwnerSchedulerJob,
} from "@/lib/db"
import { geocodeAddress } from "@/lib/geocode"
import { keyStyleRequiresFieldVerification } from "@/lib/vehicle-trim-features"
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
  service_quote_type_id?: string | null
  quoted_price_cents?: number | null
  distance_miles?: number | null
  key_fcc_id?: string | null
  key_frequency?: string | null
  key_chipset?: string | null
  key_style?: string | null
  key_variant_id?: string | null
  key_profile_id?: string | null
  discount_applied?: string | null
  baseline_quote_cents?: number | null
  dispatch_status?: string | null
  is_salvageable?: boolean | null
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
    body.job_notes !== undefined ||
    body.service_quote_type_id !== undefined ||
    body.quoted_price_cents !== undefined ||
    body.distance_miles !== undefined ||
    body.key_fcc_id !== undefined ||
    body.key_frequency !== undefined ||
    body.key_chipset !== undefined ||
    body.key_style !== undefined ||
    body.key_variant_id !== undefined ||
    body.key_profile_id !== undefined ||
    body.discount_applied !== undefined ||
    body.baseline_quote_cents !== undefined ||
    body.dispatch_status !== undefined ||
    body.is_salvageable !== undefined
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
      serviceQuoteTypeId: body.service_quote_type_id ?? null,
      quotedPriceCents:
        body.quoted_price_cents != null && Number.isFinite(Number(body.quoted_price_cents))
          ? Math.round(Number(body.quoted_price_cents))
          : null,
      distanceMiles:
        body.distance_miles != null && Number.isFinite(Number(body.distance_miles))
          ? Number(body.distance_miles)
          : null,
      keyFccId: body.key_fcc_id ?? null,
      keyFrequency: body.key_frequency ?? null,
      keyChipset: body.key_chipset ?? null,
      keyStyle: body.key_style ?? null,
      keyVariantId: body.key_variant_id ?? null,
      keyProfileId: body.key_profile_id ?? null,
      discountApplied: body.discount_applied ?? null,
      baselineQuotedPriceCents:
        body.baseline_quote_cents != null && Number.isFinite(Number(body.baseline_quote_cents))
          ? Math.round(Number(body.baseline_quote_cents))
          : null,
      fieldVerificationRequired:
        body.key_style !== undefined
          ? keyStyleRequiresFieldVerification(body.key_style)
          : undefined,
      dispatchStatus: body.dispatch_status,
      isSalvageable: body.is_salvageable,
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

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const userId = getUserIdFromRequest(_req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const { id: leadId } = await context.params
  if (!leadId?.trim()) return NextResponse.json({ error: "Missing lead id" }, { status: 400 })

  try {
    const ok = await deleteOwnerSchedulerJob(userId, leadId.trim())
    if (!ok) return NextResponse.json({ error: "Job not found" }, { status: 404 })
    return NextResponse.json({ data: { id: leadId.trim(), deleted: true } })
  } catch (e) {
    console.error("[DELETE /api/owner/scheduler/[id]]", e)
    return NextResponse.json({ error: "Failed to delete job" }, { status: 500 })
  }
}
