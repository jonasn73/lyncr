// POST /api/book/callback — missed-call recovery lead (availability + follow-up, not a hard slot).

import { NextRequest, NextResponse } from "next/server"
import {
  getUserByPhoneNumber,
  normalizePhoneNumberE164,
} from "@/lib/db"
import { createUnassignedJobFromIntake } from "@/lib/create-intake-job"
import { toE164 } from "@/lib/phone-e164"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // Business DID identifies which shop owns this lead.
  const lineRaw = typeof body.line === "string" ? body.line : ""
  const line = lineRaw ? normalizePhoneNumberE164(lineRaw) || toE164(lineRaw) : ""
  if (!line) {
    return NextResponse.json({ error: "Business line required" }, { status: 400 })
  }

  const owner = await getUserByPhoneNumber(line)
  if (!owner) {
    return NextResponse.json({ error: "Unknown business line" }, { status: 404 })
  }

  const customerPhoneRaw =
    typeof body.phone === "string"
      ? body.phone
      : typeof body.customer_phone === "string"
        ? body.customer_phone
        : ""
  const customerPhone = customerPhoneRaw
    ? normalizePhoneNumberE164(customerPhoneRaw) || toE164(customerPhoneRaw)
    : null

  const customerName =
    typeof body.customer_name === "string" ? body.customer_name.trim() : ""
  const addressLine1 =
    typeof body.address_line1 === "string"
      ? body.address_line1.trim()
      : typeof body.service_address === "string"
        ? body.service_address.trim()
        : ""
  const jobTypeRaw =
    typeof body.job_type === "string"
      ? body.job_type.trim()
      : typeof body.jobType === "string"
        ? body.jobType.trim()
        : ""
  // Free-text windows the customer is free — shop will call back, not auto-book.
  const availability =
    typeof body.availability === "string"
      ? body.availability.trim()
      : typeof body.availability_notes === "string"
        ? body.availability_notes.trim()
        : ""

  if (customerName.length < 2) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 })
  }
  if (!customerPhone) {
    return NextResponse.json({ error: "Phone number is required" }, { status: 400 })
  }
  if (addressLine1.length < 5) {
    return NextResponse.json({ error: "Service address is required" }, { status: 400 })
  }
  if (availability.length < 3) {
    return NextResponse.json(
      { error: "Tell us when you're available so we can follow up" },
      { status: 400 }
    )
  }

  const jobType = jobTypeRaw || "Missed-call callback"
  // Store availability on job notes so dispatchers see it on the lead.
  const notes = `Missed-call recovery · customer availability: ${availability}`

  try {
    const job = await createUnassignedJobFromIntake({
      ownerUserId: owner.id,
      callerE164: customerPhone,
      customerName,
      addressLine1,
      jobType,
      notes,
      // No scheduled_at — this is a callback lead, not a hard-booked appointment.
      pendingCallback: true,
      intakeSource: "missed_call_callback",
    })
    return NextResponse.json({
      data: { lead_id: job.lead_id, status: "callback_requested" },
    })
  } catch (e) {
    console.error("[POST /api/book/callback] failed:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not submit request" },
      { status: 500 }
    )
  }
}
