// ============================================
// GET /api/owner/scheduler — list calendar events
// POST /api/owner/scheduler — create manual appointment
// ============================================

import { NextRequest, NextResponse } from "next/server"
import { resolveWorkspaceActor } from "@/lib/workspace-actor"
import {
  createOwnerSchedulerAppointment,
  isReasonablePstnDialString,
  listFieldTechnicians,
  listOwnerSchedulerEvents,
  normalizePhoneNumberE164,
  setLeadStructuredAddress,
} from "@/lib/db"
import { geocodeAddress } from "@/lib/geocode"
import { persistLeadAddressFromFields } from "@/lib/geocode-persist"
import { resolveLeadCoordinates } from "@/lib/resolve-lead-coordinates"
import { monthRangeUtc, parseIsoDateParam } from "@/lib/scheduler-utils"
import {
  isCompleteStructuredAddress,
  structuredAddressValidationError,
  type StructuredAddress,
} from "@/lib/structured-address"
import type { SchedulerEvent } from "@/lib/types"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const actor = await resolveWorkspaceActor(req.headers.get("cookie"), {
    capability: "scheduler",
  })
  if (!actor) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  const userId = actor.ownerUserId

  const fromParam = req.nextUrl.searchParams.get("from")
  const toParam = req.nextUrl.searchParams.get("to")
  const monthParam = req.nextUrl.searchParams.get("month")
  const organizationId = req.nextUrl.searchParams.get("organization_id")?.trim() || null

  let fromIso = fromParam
  let toIso = toParam

  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split("-").map(Number)
    const range = monthRangeUtc(y, m - 1)
    fromIso = range.from
    toIso = range.to
  } else {
    const fromDate = parseIsoDateParam(fromParam)
    const toDate = parseIsoDateParam(toParam)
    if (fromDate) fromIso = fromDate.toISOString()
    if (toDate) toIso = toDate.toISOString()
  }

  if (!fromIso || !toIso) {
    const now = new Date()
    const range = monthRangeUtc(now.getFullYear(), now.getMonth())
    fromIso = range.from
    toIso = range.to
  }

  try {
    const events = await listOwnerSchedulerEvents({
      ownerUserId: userId,
      fromIso,
      toIso,
      organizationId: organizationId && !organizationId.startsWith("legacy-") ? organizationId : null,
    })
    return NextResponse.json({ data: { events, from: fromIso, to: toIso, ownerUserId: userId } })
  } catch (e) {
    console.error("[GET /api/owner/scheduler]", e)
    return NextResponse.json({ data: { events: [], from: fromIso, to: toIso, ownerUserId: userId }, degraded: true })
  }
}

type CreateSchedulerBody = {
  customer_name?: string
  customer_phone?: string
  job_type?: string
  scheduled_at?: string
  duration_minutes?: number
  assigned_tech_id?: string | null
  organization_id?: string | null
  vehicle_year?: string
  vehicle_make?: string
  vehicle_model?: string
  job_notes?: string
  structured_address?: Partial<StructuredAddress> | null
  intake_fields?: Record<string, unknown>
}

export async function POST(req: NextRequest) {
  const actor = await resolveWorkspaceActor(req.headers.get("cookie"), {
    capability: "scheduler",
  })
  if (!actor) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  const userId = actor.ownerUserId

  const body = (await req.json().catch(() => ({}))) as CreateSchedulerBody
  const customerName = String(body.customer_name ?? "").trim()
  const customerPhoneRaw = String(body.customer_phone ?? "").trim()
  const jobType = String(body.job_type ?? "Other").trim() || "Other"
  const scheduledRaw = String(body.scheduled_at ?? "").trim()
  const durationMinutes = Number(body.duration_minutes ?? 60) || 60
  const assignedTechId = body.assigned_tech_id?.trim() || null
  const organizationId = body.organization_id?.trim() || null
  const vehicleYear = String(body.vehicle_year ?? "").trim() || null
  const vehicleMake = String(body.vehicle_make ?? "").trim() || null
  const vehicleModel = String(body.vehicle_model ?? "").trim() || null
  const jobNotes = String(body.job_notes ?? "").trim() || null
  const structuredAddress = isCompleteStructuredAddress(body.structured_address) ? body.structured_address : null
  const extraCollected = body.intake_fields && typeof body.intake_fields === "object" ? body.intake_fields : {}

  const addressError = structuredAddressValidationError(structuredAddress)
  if (addressError) {
    return NextResponse.json({ error: addressError }, { status: 400 })
  }

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
  if (!scheduledRaw || Number.isNaN(Date.parse(scheduledRaw))) {
    return NextResponse.json({ error: "Start time is required" }, { status: 400 })
  }
  const scheduledAtIso = new Date(scheduledRaw).toISOString()

  let assignedTechName: string | null = null
  if (assignedTechId) {
    const roster = await listFieldTechnicians(userId)
    const match = roster.find((t) => t.portal_user_id === assignedTechId)
    if (!match?.portal_user_id) {
      return NextResponse.json({ error: "Selected technician is not available" }, { status: 400 })
    }
    assignedTechName = match.name
  }

  try {
    let coords = await resolveLeadCoordinates({
      structuredAddress,
      extraFields: extraCollected,
    })

    let addressForSave = structuredAddress
    if (structuredAddress && coords && (structuredAddress.lat == null || structuredAddress.lng == null)) {
      addressForSave = { ...structuredAddress, lat: coords.lat, lng: coords.lng }
    }

    let event = await createOwnerSchedulerAppointment({
      ownerUserId: userId,
      organizationId: organizationId && !organizationId.startsWith("legacy-") ? organizationId : null,
      customerName,
      customerPhoneE164,
      jobType,
      scheduledAtIso,
      durationMinutes,
      assignedTechPortalUserId: assignedTechId,
      assignedTechName,
      vehicleYear,
      vehicleMake,
      vehicleModel,
      jobAddress: addressForSave?.formatted ?? null,
      jobNotes,
      structuredAddress: addressForSave,
      extraCollected,
    })

    if (addressForSave) {
      let lat = addressForSave.lat ?? coords?.lat ?? null
      let lng = addressForSave.lng ?? coords?.lng ?? null
      if (lat == null || lng == null) {
        const geocoded = await resolveLeadCoordinates({
          structuredAddress: addressForSave,
          extraFields: extraCollected,
        })
        if (geocoded) {
          lat = geocoded.lat
          lng = geocoded.lng
        }
      }
      try {
        await setLeadStructuredAddress(event.id, { ...addressForSave, lat, lng })
        if (lat != null && lng != null) {
          event = { ...event, latitude: lat, longitude: lng } satisfies SchedulerEvent
        }
      } catch (addrErr) {
        console.warn("[POST /api/owner/scheduler] address persist skipped:", addrErr)
      }
    } else {
      try {
        await persistLeadAddressFromFields(event.id, extraCollected)
        if (!coords) {
          coords = await resolveLeadCoordinates({ extraFields: extraCollected })
        }
        if (coords) {
          event = { ...event, latitude: coords.lat, longitude: coords.lng } satisfies SchedulerEvent
        }
      } catch (addrErr) {
        console.warn("[POST /api/owner/scheduler] geocode persist skipped:", addrErr)
      }
    }

    return NextResponse.json({ data: { event } })
  } catch (e) {
    console.error("[POST /api/owner/scheduler]", e)
    return NextResponse.json({ error: "Failed to create appointment" }, { status: 500 })
  }
}
