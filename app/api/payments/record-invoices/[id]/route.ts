// GET /api/payments/record-invoices/[id]
// POST /api/payments/record-invoices/[id]  — resend (same invoice) or revise (new revision).
// Body: { action: "resend" | "revise", channel?, amountCents?, paymentMethod?, ... }

import { NextRequest, NextResponse } from "next/server"
import { resolveWorkspaceActor } from "@/lib/workspace-actor"
import {
  getJobRecordInvoiceByIdForOwner,
  jobRecordInvoiceToApi,
  reviseAndSendJobRecordInvoice,
  sendJobRecordInvoice,
  type RecordInvoicePaymentMethod,
  type SendRecordInvoiceChannel,
} from "@/lib/job-record-invoice"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

function parseMethod(raw: unknown): RecordInvoicePaymentMethod | null {
  if (raw == null) return null
  const v = String(raw).trim().toUpperCase()
  if (v === "VENMO" || v === "CASH" || v === "OTHER" || v === "EXTERNAL") return v
  return null
}

function parseChannel(raw: unknown, fallback: SendRecordInvoiceChannel): SendRecordInvoiceChannel {
  const v = String(raw ?? fallback).trim().toLowerCase()
  if (v === "email" || v === "sms" || v === "both") return v
  return fallback
}

function defaultChannelFromRow(channelsRequested: string): SendRecordInvoiceChannel {
  const v = channelsRequested.trim().toLowerCase()
  if (v === "email" || v === "sms" || v === "both") return v
  return "sms"
}

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  const actor = await resolveWorkspaceActor(req.headers.get("cookie"), {
    capability: "invoicing",
  })
  if (!actor) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  const userId = actor.ownerUserId

  const { id } = await ctx.params
  const invoice = await getJobRecordInvoiceByIdForOwner(userId, id)
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 })

  return NextResponse.json({ data: { invoice: jobRecordInvoiceToApi(invoice) } })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const actor = await resolveWorkspaceActor(req.headers.get("cookie"), {
    capability: "invoicing_send",
  })
  if (!actor) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  const userId = actor.ownerUserId

  const { id } = await ctx.params
  const invoice = await getJobRecordInvoiceByIdForOwner(userId, id)
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const action = String(body.action ?? "resend").trim().toLowerCase()
  const channel = parseChannel(body.channel, defaultChannelFromRow(invoice.channelsRequested))

  try {
    if (action === "revise") {
      // New revision row — never silently overwrites the sent invoice.
      let amountCents: number | null = null
      if (body.amountCents != null || body.amount_cents != null) {
        amountCents = Math.round(Number(body.amountCents ?? body.amount_cents) || 0)
      } else if (body.amount != null) {
        const dollars = Number(body.amount)
        if (Number.isFinite(dollars) && dollars > 0) amountCents = Math.round(dollars * 100)
      }

      const result = await reviseAndSendJobRecordInvoice({
        userId,
        source: invoice,
        channel,
        amountCents,
        paymentMethod: parseMethod(body.paymentMethod ?? body.payment_method),
        paymentNote:
          typeof body.paymentNote === "string"
            ? body.paymentNote
            : typeof body.payment_note === "string"
              ? body.payment_note
              : null,
        customerName:
          typeof body.customerName === "string"
            ? body.customerName
            : typeof body.customer_name === "string"
              ? body.customer_name
              : null,
        customerEmail:
          typeof body.email === "string"
            ? body.email
            : typeof body.customerEmail === "string"
              ? body.customerEmail
              : null,
        customerPhone:
          typeof body.phone === "string"
            ? body.phone
            : typeof body.customerPhone === "string"
              ? body.customerPhone
              : null,
        serviceLabel:
          typeof body.serviceLabel === "string"
            ? body.serviceLabel
            : typeof body.service_label === "string"
              ? body.service_label
              : null,
        vehicleLabel:
          typeof body.vehicleLabel === "string"
            ? body.vehicleLabel
            : typeof body.vehicle_label === "string"
              ? body.vehicle_label
              : null,
        vehicleVin:
          typeof body.vehicleVin === "string"
            ? body.vehicleVin
            : typeof body.vehicle_vin === "string"
              ? body.vehicle_vin
              : null,
        addressLine1:
          typeof body.addressLine1 === "string"
            ? body.addressLine1
            : typeof body.address_line1 === "string"
              ? body.address_line1
              : null,
      })

      return NextResponse.json({
        data: {
          sent: result.sent,
          channels: result.channels,
          deliveryStatus: result.deliveryStatus,
          receiptUrl: result.receiptUrl,
          invoice: jobRecordInvoiceToApi(result.invoice),
          revised: true,
          error: result.error,
        },
      }, { status: result.sent ? 200 : 400 })
    }

    // Default: resend / retry the same invoice (same public URL).
    const email =
      typeof body.email === "string"
        ? body.email
        : typeof body.customerEmail === "string"
          ? body.customerEmail
          : invoice.customerEmail
    const phone =
      typeof body.phone === "string"
        ? body.phone
        : typeof body.customerPhone === "string"
          ? body.customerPhone
          : invoice.customerPhone

    const result = await sendJobRecordInvoice({
      userId,
      invoice,
      channel,
      email,
      phone,
      customerName:
        typeof body.customerName === "string"
          ? body.customerName
          : invoice.customerName,
    })

    return NextResponse.json(
      {
        data: {
          sent: result.sent,
          channels: result.channels,
          deliveryStatus: result.deliveryStatus,
          receiptUrl: result.receiptUrl,
          invoice: jobRecordInvoiceToApi(result.invoice),
          revised: false,
          error: result.error,
        },
      },
      { status: result.sent ? 200 : 400 }
    )
  } catch (e) {
    console.error("[payments/record-invoices/[id] POST]", e)
    const message = e instanceof Error ? e.message : "Could not resend invoice"
    const migration = /migration 13[23]/i.test(message)
      ? /133/.test(message)
        ? "scripts/133-job-record-invoice-history.sql"
        : "scripts/132-job-record-invoices.sql"
      : undefined
    return NextResponse.json(
      { error: message, migration },
      { status: migration ? 503 : 500 }
    )
  }
}
