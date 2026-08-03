// GET/POST /api/book/form/[id]
// Public: load Activity book-link invite + save form → CRM/intake (+ pay URL when needed).

import { NextRequest, NextResponse } from "next/server"
import { getUser } from "@/lib/db"
import {
  buildBookCollectedExtras,
  formatBookAvailabilityLabel,
  isValidBookTimeRange,
  type BookUrgency,
} from "@/lib/book-customer-request"
import { createUnassignedJobFromIntake } from "@/lib/create-intake-job"
import { getAppUrl } from "@/lib/telnyx"
import {
  getIntakeBookLinkById,
  intakeBookFeeLabel,
  jobTypeFromBookFormKind,
  markIntakeBookLinkSubmitted,
} from "@/lib/intake-book-link"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type RouteCtx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params
  const link = await getIntakeBookLinkById(id)
  if (!link) {
    return NextResponse.json(
      { error: "This link is invalid or has expired. Ask the shop for a new one." },
      { status: 404 }
    )
  }

  const owner = await getUser(link.ownerUserId)
  const businessLabel =
    owner?.business_name?.trim() || owner?.name?.trim() || "Your locksmith"

  return NextResponse.json({
    data: {
      business_label: businessLabel,
      fee_mode: link.feeMode,
      quote_cents: link.quoteCents,
      amount_dollars: link.quoteCents / 100,
      fee_label: intakeBookFeeLabel(link.feeMode, link.quoteCents),
      requires_payment: link.feeMode !== "none" && Boolean(link.payToken),
      pay_token: link.payToken,
      operator_note: link.operatorNote || "",
      already_submitted: Boolean(link.submittedAt && link.jobId),
      prefill: {
        // Phone locked to the call that received the SMS
        phone: link.callerPhone,
        customer_name: "",
        address: "",
        vehicle_year: "",
        vehicle_make: "",
        vehicle_model: "",
        vehicle_text: "",
        job_kind: "",
        notes: "",
      },
    },
  })
}

type PostBody = {
  customer_name?: string
  phone?: string
  email?: string
  address?: string
  vehicle_year?: string
  vehicle_make?: string
  vehicle_model?: string
  /** Free-text vehicle when YMM is empty (e.g. "2018 Honda Civic"). */
  vehicle_text?: string
  job_kind?: string
  notes?: string
  urgency?: string
  is_asap?: boolean
  availability_date?: string
  availability_from?: string
  availability_to?: string
  availability?: string
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params
  const link = await getIntakeBookLinkById(id)
  if (!link) {
    return NextResponse.json(
      { error: "This link is invalid or has expired. Ask the shop for a new one." },
      { status: 404 }
    )
  }

  const body = (await req.json().catch(() => ({}))) as PostBody
  const customerName = String(body.customer_name ?? "").trim().slice(0, 120)
  const phone = String(body.phone ?? link.callerPhone ?? "").trim().slice(0, 40)
  const email = String(body.email ?? "").trim().slice(0, 160)
  const address = String(body.address ?? "").trim().slice(0, 240)
  let year = String(body.vehicle_year ?? "").trim().slice(0, 8)
  let make = String(body.vehicle_make ?? "").trim().slice(0, 60)
  let model = String(body.vehicle_model ?? "").trim().slice(0, 60)
  const vehicleText = String(body.vehicle_text ?? "").trim().slice(0, 120)
  const jobKind = String(body.job_kind ?? "").trim().toLowerCase().slice(0, 40)
  const notes = String(body.notes ?? "").trim().slice(0, 800)

  const urgencyRaw = String(body.urgency ?? "").trim().toLowerCase()
  const isAsap =
    body.is_asap === true || urgencyRaw === "asap" || urgencyRaw === "emergency"
  const urgency: BookUrgency = isAsap ? "asap" : "window"

  const availabilityDate = String(body.availability_date ?? "").trim().slice(0, 16)
  const availabilityFrom = String(body.availability_from ?? "").trim().slice(0, 8)
  const availabilityTo = String(body.availability_to ?? "").trim().slice(0, 8)
  const availabilityFree = String(body.availability ?? "").trim().slice(0, 200)

  if (!customerName) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 })
  }
  if (!phone) {
    return NextResponse.json({ error: "Phone is required" }, { status: 400 })
  }
  if (!address) {
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
  } else if (availabilityFree.length >= 3) {
    availabilityLabel = availabilityFree
  } else {
    return NextResponse.json(
      { error: "Pick a day and a time window, or choose Emergency / ASAP" },
      { status: 400 }
    )
  }

  // If YMM empty but free-text present, stash free-text into make so intake still shows a vehicle.
  if (!year && !make && !model && vehicleText) {
    make = vehicleText
  }

  const jobType = jobTypeFromBookFormKind(jobKind)
  const operatorBit = link.operatorNote
    ? `Owner note: ${link.operatorNote}`
    : null
  const urgencyBit =
    urgency === "asap"
      ? "Customer urgency: ASAP / emergency"
      : `Customer availability: ${availabilityLabel}`
  const combinedNotes = [notes || null, urgencyBit, operatorBit, "Source: Activity book link"]
    .filter(Boolean)
    .join("\n")

  const collectedExtras = buildBookCollectedExtras({
    urgency,
    email: email || null,
    jobKind: jobKind || null,
    notes: notes || null,
    availabilityDate: urgency === "window" ? availabilityDate : null,
    availabilityFrom: urgency === "window" ? availabilityFrom : null,
    availabilityTo: urgency === "window" ? availabilityTo : null,
    availabilityLabel,
  })

  try {
    // Creates/updates CRM customer + ai_leads draft for this phone (open lead upgrade when present).
    const result = await createUnassignedJobFromIntake({
      ownerUserId: link.ownerUserId,
      callLogId: link.callLogId,
      callerE164: phone,
      customerName,
      addressLine1: address,
      notes: combinedNotes,
      vehicleYear: year || null,
      vehicleMake: make || null,
      vehicleModel: model || null,
      jobType,
      quotedPriceCents: link.quoteCents > 0 ? link.quoteCents : null,
      customerEmail: email || null,
      collectedExtras,
      intakeSource: "activity_book_link",
      // ASAP stays a callback priority; window is still a soft lead until owner confirms.
      pendingCallback: urgency === "asap",
      // Customer already came from our SMS — don't send another booking confirmation.
      deferCustomerSms: true,
    })

    await markIntakeBookLinkSubmitted({ id: link.id, jobId: result.lead_id })

    const requiresPayment = link.feeMode !== "none" && Boolean(link.payToken)
    const payUrl = requiresPayment
      ? `${getAppUrl().replace(/\/$/, "")}/pay/${link.payToken}`
      : null

    return NextResponse.json({
      data: {
        lead_id: result.lead_id,
        requires_payment: requiresPayment,
        pay_token: link.payToken,
        // Same-page Embedded Checkout uses this; also works as a fallback redirect.
        pay_url: payUrl,
        thank_you: !requiresPayment,
        urgency,
        availability: availabilityLabel,
      },
    })
  } catch (e) {
    console.error("[book/form] submit failed:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not save your info" },
      { status: 500 }
    )
  }
}
