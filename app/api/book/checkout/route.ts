// POST /api/book/checkout — hold a preferred window start + Stripe deposit when required.
// Slot-wall booking is gone; customers send a From–To range (From becomes scheduled_at).

import { NextRequest, NextResponse } from "next/server"
import {
  getUserByPhoneNumber,
  normalizePhoneNumberE164,
} from "@/lib/db"
import {
  bookWindowStartIso,
  buildBookCollectedExtras,
  formatBookAvailabilityLabel,
  isValidBookTimeRange,
  jobTypeFromBookFormKind,
} from "@/lib/book-customer-request"
import {
  createBookingDepositCheckout,
  createBookingHold,
  getUserRequireDeposit,
} from "@/lib/booking-deposit"
import { createUnassignedJobFromIntake } from "@/lib/create-intake-job"
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

  const lineRaw = readString(body, "line")
  const line = lineRaw ? normalizePhoneNumberE164(lineRaw) || toE164(lineRaw) : ""
  if (!line) {
    return NextResponse.json({ error: "Business line required" }, { status: 400 })
  }

  const owner = await getUserByPhoneNumber(line)
  if (!owner) {
    return NextResponse.json({ error: "Unknown business line" }, { status: 404 })
  }

  // Prefer structured window; fall back to legacy scheduled_at (old clients).
  const availabilityDate = readString(body, "availability_date", "date")
  const availabilityFrom = readString(body, "availability_from", "from", "from_time")
  const availabilityTo = readString(body, "availability_to", "to", "to_time")
  let scheduledAtIso = readString(body, "scheduled_at", "scheduledAtIso")

  if (!scheduledAtIso && availabilityDate && availabilityFrom) {
    const iso = bookWindowStartIso(availabilityDate, availabilityFrom)
    if (iso) scheduledAtIso = iso
  }
  if (!scheduledAtIso || Number.isNaN(Date.parse(scheduledAtIso))) {
    return NextResponse.json(
      { error: "Pick a day and start time for your window" },
      { status: 400 }
    )
  }

  let availabilityLabel = ""
  if (availabilityDate && availabilityFrom && availabilityTo) {
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
  } else {
    availabilityLabel = `Preferred start ${scheduledAtIso}`
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

  if (customerName.length < 2) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 })
  }
  if (addressLine1.length < 5) {
    return NextResponse.json({ error: "Service address is required" }, { status: 400 })
  }

  const jobType =
    (jobKind ? jobTypeFromBookFormKind(jobKind) : "") || jobTypeRaw || "Booked online"

  let year = vehicleYear
  let make = vehicleMake
  let model = vehicleModel
  if (!year && !make && !model && vehicleText) {
    make = vehicleText
  }

  const collectedExtras = buildBookCollectedExtras({
    urgency: "window",
    email: customerEmail || null,
    jobKind: jobKind || null,
    notes: notes || null,
    availabilityDate: availabilityDate || null,
    availabilityFrom: availabilityFrom || null,
    availabilityTo: availabilityTo || null,
    availabilityLabel,
  })

  const noteParts = [
    `Public /book · preferred window: ${availabilityLabel}`,
    notes || null,
  ].filter(Boolean)

  const requireDeposit = await getUserRequireDeposit(owner.id)

  if (!requireDeposit) {
    // No deposit — create the job with preferred window metadata (soft hold at From time).
    try {
      const job = await createUnassignedJobFromIntake({
        ownerUserId: owner.id,
        callerE164: customerPhone || "+10000000000",
        customerName,
        addressLine1,
        jobType,
        notes: noteParts.join("\n"),
        vehicleYear: year || null,
        vehicleMake: make || null,
        vehicleModel: model || null,
        customerEmail: customerEmail || null,
        collectedExtras,
        scheduledAtIso,
        pendingCallback: false,
        intakeSource: "public_book",
      })
      return NextResponse.json({
        data: {
          require_deposit: false,
          lead_id: job.lead_id,
          status: "booked",
          availability: availabilityLabel,
        },
      })
    } catch (e) {
      console.error("[POST /api/book/checkout] book failed:", e)
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Booking failed" },
        { status: 500 }
      )
    }
  }

  try {
    const hold = await createBookingHold({
      ownerUserId: owner.id,
      businessLine: line,
      customerPhone,
      customerName,
      scheduledAtIso,
    })
    const checkout = await createBookingDepositCheckout({
      ownerUserId: owner.id,
      holdId: hold.id,
      amountCents: hold.amountCents,
      customerEmail: customerEmail || null,
      intakeExtras: {
        address_line1: addressLine1,
        job_type: jobType,
      },
    })
    return NextResponse.json({
      data: {
        require_deposit: true,
        hold_id: hold.id,
        checkout_url: checkout.url,
        status: "pending_payment",
        availability: availabilityLabel,
      },
    })
  } catch (e) {
    console.error("[POST /api/book/checkout] deposit failed:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Checkout failed" },
      { status: 500 }
    )
  }
}
