// POST /api/book/checkout — hold a slot and start Stripe deposit checkout when required.

import { NextRequest, NextResponse } from "next/server"
import {
  getUserByPhoneNumber,
  normalizePhoneNumberE164,
} from "@/lib/db"
import {
  createBookingDepositCheckout,
  createBookingHold,
  getUserRequireDeposit,
} from "@/lib/booking-deposit"
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

  const lineRaw = typeof body.line === "string" ? body.line : ""
  const line = lineRaw ? normalizePhoneNumberE164(lineRaw) || toE164(lineRaw) : ""
  if (!line) {
    return NextResponse.json({ error: "Business line required" }, { status: 400 })
  }

  const owner = await getUserByPhoneNumber(line)
  if (!owner) {
    return NextResponse.json({ error: "Unknown business line" }, { status: 404 })
  }

  const scheduledAtIso =
    typeof body.scheduled_at === "string"
      ? body.scheduled_at
      : typeof body.scheduledAtIso === "string"
        ? body.scheduledAtIso
        : ""
  if (!scheduledAtIso || Number.isNaN(Date.parse(scheduledAtIso))) {
    return NextResponse.json({ error: "Pick a valid time slot" }, { status: 400 })
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
    typeof body.customer_name === "string" ? body.customer_name.trim() : "Online booking"

  const requireDeposit = await getUserRequireDeposit(owner.id)

  if (!requireDeposit) {
    // No deposit — create the job immediately (same as a soft hold).
    try {
      const job = await createUnassignedJobFromIntake({
        ownerUserId: owner.id,
        callerE164: customerPhone || "+10000000000",
        customerName: customerName || "Online booking",
        jobType: "Booked online",
        notes: `Public /book · ${scheduledAtIso}`,
        scheduledAtIso,
        pendingCallback: false,
        // Tag so Caller ID / Textback cards can attribute rescued revenue.
        intakeSource: "public_book",
      })
      return NextResponse.json({
        data: { require_deposit: false, lead_id: job.lead_id, status: "booked" },
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
    })
    return NextResponse.json({
      data: {
        require_deposit: true,
        hold_id: hold.id,
        checkout_url: checkout.url,
        status: "pending_payment",
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
