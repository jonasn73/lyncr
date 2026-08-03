// POST /api/book/callback — customer request (ASAP or preferred window).
// Used by /book/[id] for missed-call + unified availability flow (no hour-slot wall).

import { NextRequest, NextResponse } from "next/server"
import {
  getUserByPhoneNumber,
  normalizePhoneNumberE164,
} from "@/lib/db"
import {
  buildBookCollectedExtras,
  formatBookAvailabilityLabel,
  isValidBookTimeRange,
  jobTypeFromBookFormKind,
  type BookUrgency,
} from "@/lib/book-customer-request"
import { createUnassignedJobFromIntake } from "@/lib/create-intake-job"
import { notifyOwnerBookFormSubmitted } from "@/lib/book-form-owner-alert"
import { toE164 } from "@/lib/phone-e164"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

function readString(body: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = body[key]
    if (typeof v === "string" && v.trim()) return v.trim()
  }
  return ""
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // Business DID identifies which shop owns this lead.
  const lineRaw = readString(body, "line")
  const line = lineRaw ? normalizePhoneNumberE164(lineRaw) || toE164(lineRaw) : ""
  if (!line) {
    return NextResponse.json({ error: "Business line required" }, { status: 400 })
  }

  const owner = await getUserByPhoneNumber(line)
  if (!owner) {
    return NextResponse.json({ error: "Unknown business line" }, { status: 404 })
  }

  const customerPhoneRaw = readString(body, "phone", "customer_phone")
  const customerPhone = customerPhoneRaw
    ? normalizePhoneNumberE164(customerPhoneRaw) || toE164(customerPhoneRaw)
    : null

  const customerName = readString(body, "customer_name")
  const addressLine1 = readString(body, "address_line1", "service_address", "address")
  const customerEmail = readString(body, "email", "customer_email")
  const notes = readString(body, "notes", "customer_notes")
  const vehicleYear = readString(body, "vehicle_year", "year")
  const vehicleMake = readString(body, "vehicle_make", "make")
  const vehicleModel = readString(body, "vehicle_model", "model")
  const vehicleText = readString(body, "vehicle_text")
  const jobKind = readString(body, "job_kind").toLowerCase()
  const jobTypeRaw = readString(body, "job_type", "jobType")

  // ASAP skips availability; window requires one day + from–to.
  const urgencyRaw = readString(body, "urgency").toLowerCase()
  const isAsapFlag =
    body.is_asap === true ||
    body.isAsap === true ||
    urgencyRaw === "asap" ||
    urgencyRaw === "emergency"
  const urgency: BookUrgency = isAsapFlag ? "asap" : "window"

  const availabilityDate = readString(body, "availability_date", "date")
  const availabilityFrom = readString(body, "availability_from", "from", "from_time")
  const availabilityTo = readString(body, "availability_to", "to", "to_time")
  // Legacy free-text (older missed-call form) still accepted.
  const availabilityNotes = readString(body, "availability", "availability_notes")

  if (customerName.length < 2) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 })
  }
  if (!customerPhone) {
    return NextResponse.json({ error: "Phone number is required" }, { status: 400 })
  }
  if (addressLine1.length < 5) {
    return NextResponse.json({ error: "Service address is required" }, { status: 400 })
  }

  let availabilityLabel = ""
  if (urgency === "asap") {
    availabilityLabel = "ASAP / emergency"
  } else if (availabilityDate && availabilityFrom && availabilityTo) {
    if (!isValidBookTimeRange(availabilityFrom, availabilityTo)) {
      return NextResponse.json(
        { error: "Choose an end time after the start time" },
        { status: 400 }
      )
    }
    availabilityLabel = formatBookAvailabilityLabel({
      dateKey: availabilityDate,
      fromHhmm: availabilityFrom,
      toHhmm: availabilityTo,
    })
  } else if (availabilityNotes.length >= 3) {
    availabilityLabel = availabilityNotes
  } else {
    return NextResponse.json(
      { error: "Pick a day and a time window, or choose Emergency / ASAP" },
      { status: 400 }
    )
  }

  // Prefer job_kind chips; fall back to free-text job_type.
  const jobType =
    (jobKind ? jobTypeFromBookFormKind(jobKind) : "") ||
    jobTypeRaw ||
    (urgency === "asap" ? "Emergency service" : "Service call")

  // If YMM empty but free-text present, stash into make so intake still shows a vehicle.
  let year = vehicleYear
  let make = vehicleMake
  let model = vehicleModel
  if (!year && !make && !model && vehicleText) {
    make = vehicleText
  }

  const collectedExtras = buildBookCollectedExtras({
    urgency,
    email: customerEmail || null,
    jobKind: jobKind || null,
    notes: notes || null,
    availabilityDate: urgency === "window" ? availabilityDate : null,
    availabilityFrom: urgency === "window" ? availabilityFrom : null,
    availabilityTo: urgency === "window" ? availabilityTo : null,
    availabilityLabel,
  })

  const noteParts = [
    urgency === "asap"
      ? "Customer booking · EMERGENCY / ASAP"
      : `Customer booking · preferred window: ${availabilityLabel}`,
    notes || null,
    vehicleText && (year || vehicleMake || vehicleModel) ? `Vehicle note: ${vehicleText}` : null,
  ].filter(Boolean)

  try {
    const job = await createUnassignedJobFromIntake({
      ownerUserId: owner.id,
      callerE164: customerPhone,
      customerName,
      addressLine1,
      jobType,
      notes: noteParts.join("\n"),
      vehicleYear: year || null,
      vehicleMake: make || null,
      vehicleModel: model || null,
      customerEmail: customerEmail || null,
      collectedExtras,
      // Callback lead — dispatcher confirms / schedules; not a hard calendar slot.
      pendingCallback: true,
      intakeSource:
        urgency === "asap" ? "public_book_asap" : "public_book_window",
    })

    // Latest + SMS + toastable Pusher — createUnassignedJobFromIntake alone was silent.
    await notifyOwnerBookFormSubmitted({
      ownerUserId: owner.id,
      leadId: job.lead_id,
      callerE164: customerPhone,
      customerName,
      urgency,
      availabilityLabel,
      summary: `${jobType} — ${customerName}`,
      collected: collectedExtras,
    })

    return NextResponse.json({
      data: {
        lead_id: job.lead_id,
        status: urgency === "asap" ? "asap_requested" : "callback_requested",
        urgency,
        availability: availabilityLabel,
      },
    })
  } catch (e) {
    console.error("[POST /api/book/callback] failed:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not submit request" },
      { status: 500 }
    )
  }
}
