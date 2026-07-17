// POST /api/inventory/special-order
// Creates a $50 non-refundable Stripe retainer + Pending Deposit job for out-of-stock keys.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  createBookingDepositCheckout,
  createBookingHold,
  SPECIAL_ORDER_RETAINER_CENTS,
} from "@/lib/booking-deposit"
import { createUnassignedJobFromIntake } from "@/lib/create-intake-job"

export const dynamic = "force-dynamic"

type Body = {
  caller_e164?: string
  customer_name?: string
  customer_email?: string | null
  address_line1?: string | null
  address_line2?: string | null
  city?: string | null
  region?: string | null
  postal_code?: string | null
  country?: string | null
  notes?: string | null
  vehicle_year?: string | null
  vehicle_make?: string | null
  vehicle_model?: string | null
  key_fcc_id?: string | null
  key_style?: string | null
  sku?: string | null
  call_log_id?: string | null
  organization_id?: string | null
  /** ISO date (YYYY-MM-DD) — earliest ship/delivery target (min +2 days). */
  earliest_service_date?: string | null
  business_line?: string | null
}

function earliestAllowedDateIso(): string {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + 2)
  return d.toISOString().slice(0, 10)
}

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const customerName = String(body.customer_name ?? "").trim()
  const callerE164 = String(body.caller_e164 ?? "").trim()
  if (!customerName || !callerE164) {
    return NextResponse.json({ error: "customer_name and caller_e164 are required" }, { status: 400 })
  }

  const minDate = earliestAllowedDateIso()
  let serviceDate = String(body.earliest_service_date ?? "").trim() || minDate
  if (serviceDate < minDate) serviceDate = minDate
  const scheduledAtIso = new Date(`${serviceDate}T12:00:00`).toISOString()

  try {
    const hold = await createBookingHold({
      ownerUserId: userId,
      businessLine: body.business_line?.trim() || null,
      customerPhone: callerE164,
      customerName,
      scheduledAtIso,
      amountCents: SPECIAL_ORDER_RETAINER_CENTS,
    })

    const checkout = await createBookingDepositCheckout({
      ownerUserId: userId,
      holdId: hold.id,
      amountCents: SPECIAL_ORDER_RETAINER_CENTS,
      customerEmail: body.customer_email?.trim() || null,
      purpose: "special_order_retainer",
    })

    const orgRaw = body.organization_id?.trim() || null
    const organizationId = orgRaw && !orgRaw.startsWith("legacy-") ? orgRaw : null
    const skuNote = body.sku?.trim() ? `SKU ${body.sku.trim()}. ` : ""

    const job = await createUnassignedJobFromIntake({
      ownerUserId: userId,
      organizationId,
      callLogId: body.call_log_id?.trim() || null,
      callerE164,
      customerName,
      addressLine1: body.address_line1?.trim() || "Special order — address TBD",
      addressLine2: body.address_line2?.trim() || null,
      city: body.city?.trim() || "TBD",
      region: body.region?.trim() || null,
      postalCode: body.postal_code?.trim() || null,
      country: body.country?.trim() || "US",
      notes: [
        body.notes?.trim(),
        `${skuNote}Special order retainer $50 (non-refundable). Earliest service ${serviceDate}.`,
        `Checkout: ${checkout.url}`,
      ]
        .filter(Boolean)
        .join(" "),
      vehicleYear: body.vehicle_year?.trim() || null,
      vehicleMake: body.vehicle_make?.trim() || null,
      vehicleModel: body.vehicle_model?.trim() || null,
      keyFccId: body.key_fcc_id?.trim() || null,
      keyStyle: body.key_style?.trim() || null,
      scheduledAtIso,
      pendingCallback: true,
      stockFallback: {
        kind: "special_order",
        checkoutUrl: checkout.url,
        holdId: hold.id,
      },
    })

    return NextResponse.json({
      data: {
        lead_id: job.lead_id,
        job_status: "pending_deposit",
        hold_id: hold.id,
        checkout_url: checkout.url,
        amount_cents: SPECIAL_ORDER_RETAINER_CENTS,
        earliest_service_date: serviceDate,
      },
    })
  } catch (e) {
    console.error("[inventory/special-order]", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not create special order" },
      { status: 500 }
    )
  }
}
