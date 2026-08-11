// POST /api/payments/send-record-invoice
// Create + email/SMS a paid-outside-Lyncr invoice (Venmo / cash / other) — no Stripe charge.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  getCustomerByIdForUser,
  getOwnerSchedulerEventById,
  getUser,
  upsertCustomerVehicleFromIntake,
} from "@/lib/db"
import {
  createJobRecordInvoice,
  sendJobRecordInvoice,
  type RecordInvoicePaymentMethod,
  type SendRecordInvoiceChannel,
} from "@/lib/job-record-invoice"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

function parseMethod(raw: unknown): RecordInvoicePaymentMethod {
  const v = String(raw ?? "VENMO").trim().toUpperCase()
  if (v === "CASH" || v === "OTHER" || v === "EXTERNAL") return v
  return "VENMO"
}

function parseChannel(raw: unknown): SendRecordInvoiceChannel {
  const v = String(raw ?? "sms").trim().toLowerCase()
  if (v === "email" || v === "both") return v
  return "sms"
}

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  const customerId = String(body.customerId ?? "").trim() || null
  const jobId = String(body.jobId ?? "").trim() || null
  const amountCentsRaw = body.amountCents ?? body.amount_cents
  let amountCents =
    typeof amountCentsRaw === "number"
      ? Math.round(amountCentsRaw)
      : Math.round(Number(amountCentsRaw) || 0)

  // Allow dollars in `amount` when cents omitted (e.g. 75 → 7500).
  if ((!amountCents || amountCents <= 0) && body.amount != null) {
    const dollars = Number(body.amount)
    if (Number.isFinite(dollars) && dollars > 0) {
      amountCents = Math.round(dollars * 100)
    }
  }

  const paymentMethod = parseMethod(body.paymentMethod ?? body.payment_method)
  const channel = parseChannel(body.channel)
  const paymentNote =
    typeof body.paymentNote === "string"
      ? body.paymentNote
      : typeof body.payment_note === "string"
        ? body.payment_note
        : null

  let customerName = String(body.customerName ?? body.customer_name ?? "").trim()
  let customerEmail = String(body.email ?? body.customerEmail ?? "").trim()
  let customerPhone = String(body.phone ?? body.customerPhone ?? "").trim()
  let serviceLabel = String(body.serviceLabel ?? body.service_label ?? "").trim()
  let vehicleLabel = String(body.vehicleLabel ?? body.vehicle_label ?? "").trim()
  let vehicleVin = String(body.vehicleVin ?? body.vehicle_vin ?? "").trim()
  let addressLine1 = String(body.addressLine1 ?? body.address_line1 ?? "").trim()
  const vehicleYear = String(body.vehicleYear ?? body.vehicle_year ?? "").trim()
  const vehicleMake = String(body.vehicleMake ?? body.vehicle_make ?? "").trim()
  const vehicleModel = String(body.vehicleModel ?? body.vehicle_model ?? "").trim()

  if (!vehicleLabel && (vehicleYear || vehicleMake || vehicleModel)) {
    vehicleLabel = [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(" ")
  }

  // Prefill from CRM customer when id is provided.
  if (customerId) {
    const customer = await getCustomerByIdForUser(userId, customerId)
    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 })
    }
    if (!customerName) customerName = (customer.display_name || "").trim()
    if (!customerPhone) customerPhone = customer.phone_e164
    if (!addressLine1) {
      addressLine1 = [customer.address_line1, customer.city, customer.region, customer.postal_code]
        .filter(Boolean)
        .join(", ")
    }
  }

  // Prefill from the job when linked.
  if (jobId) {
    const event = await getOwnerSchedulerEventById(userId, jobId)
    if (!event) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 })
    }
    if (!customerName) customerName = (event.customer_name || "").trim()
    if (!customerPhone) customerPhone = (event.customer_phone || "").trim()
    if (!serviceLabel) serviceLabel = (event.job_type || "").trim()
    if (!vehicleLabel) {
      vehicleLabel = [event.vehicle_year, event.vehicle_make, event.vehicle_model]
        .filter(Boolean)
        .join(" ")
    }
    if (!vehicleVin) vehicleVin = (event.vehicle_vin || event.vin || "").trim()
    if (!addressLine1) addressLine1 = (event.location || "").trim()
    if ((!amountCents || amountCents <= 0) && event.quoted_price_cents != null) {
      amountCents = Math.round(Number(event.quoted_price_cents) || 0)
    }
  }

  if (!amountCents || amountCents <= 0) {
    return NextResponse.json({ error: "Enter an amount greater than $0" }, { status: 400 })
  }

  // Keep garage in sync when YMM (+ optional VIN) was typed on the invoice sheet.
  if (customerId && (vehicleYear || vehicleMake || vehicleModel || vehicleVin)) {
    try {
      await upsertCustomerVehicleFromIntake({
        userId,
        customerId,
        year: vehicleYear || vehicleLabel.split(/\s+/)[0] || "",
        make: vehicleMake,
        model: vehicleModel,
        vin: vehicleVin,
      })
    } catch (e) {
      console.warn("[send-record-invoice] garage upsert skipped", e)
    }
  }

  try {
    const invoice = await createJobRecordInvoice({
      ownerUserId: userId,
      customerId,
      jobId,
      amountCents,
      paymentMethod,
      paymentNote,
      customerName,
      customerEmail,
      customerPhone,
      serviceLabel,
      vehicleLabel,
      vehicleVin,
      addressLine1,
    })

    const result = await sendJobRecordInvoice({
      userId,
      invoice,
      channel,
      email: customerEmail,
      phone: customerPhone,
      customerName,
    })

    if (!result.sent) {
      return NextResponse.json(
        {
          error: result.error || "Could not send invoice",
          data: {
            invoiceId: invoice.id,
            receiptToken: invoice.receiptToken,
            receiptUrl: result.receiptUrl,
          },
          migration: /migration 132/i.test(result.error || "")
            ? "scripts/132-job-record-invoices.sql"
            : undefined,
        },
        { status: 400 }
      )
    }

    return NextResponse.json({
      data: {
        sent: true,
        channels: result.channels,
        invoiceId: invoice.id,
        receiptToken: invoice.receiptToken,
        receiptUrl: result.receiptUrl,
        paymentMethod: invoice.paymentMethod,
      },
    })
  } catch (e) {
    console.error("[payments/send-record-invoice]", e)
    const message = e instanceof Error ? e.message : "Could not send invoice"
    const migration = /migration 132/i.test(message)
      ? "scripts/132-job-record-invoices.sql"
      : undefined
    return NextResponse.json(
      { error: message, migration },
      { status: migration ? 503 : 500 }
    )
  }
}
