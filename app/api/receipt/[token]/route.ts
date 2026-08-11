// GET /api/receipt/[token] — public invoice JSON for the customer receipt page.

import { NextRequest, NextResponse } from "next/server"
import { verifyPaymentReceiptToken } from "@/lib/payment-receipt-token"
import { resolveReceiptToken } from "@/lib/payment-receipt-short-token"
import { loadPaymentInvoice } from "@/lib/payment-invoice"
import {
  getJobRecordInvoiceByToken,
  recordInvoiceToPaymentInvoice,
} from "@/lib/job-record-invoice"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

function invoiceJson(invoice: Awaited<ReturnType<typeof loadPaymentInvoice>>) {
  return {
    invoiceNumber: invoice.invoiceNumber,
    businessName: invoice.businessName,
    businessPhone: invoice.businessPhone,
    customerName: invoice.customerName,
    paidAtLabel: invoice.paidAtLabel,
    description: invoice.description,
    lines: invoice.lines,
    subtotalCents: invoice.subtotalCents,
    taxCents: invoice.taxCents,
    tipCents: invoice.tipCents,
    totalCents: invoice.totalCents,
    paymentMethodLabel: invoice.paymentMethodLabel,
    signaturePng: invoice.signaturePng,
    paymentIntentId: invoice.paymentIntentId,
    vehicleLabel: invoice.vehicleLabel ?? null,
    vehicleVin: invoice.vehicleVin ?? null,
    addressLine1: invoice.addressLine1 ?? null,
    paidNote: invoice.paidNote ?? null,
  }
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token: raw } = await context.params
  const token = decodeURIComponent(String(raw || "").trim())

  // Paid-outside-Lyncr invoices (Venmo / cash) use the same /r/{token} URL.
  const record = await getJobRecordInvoiceByToken(token)
  if (record) {
    try {
      const invoice = await recordInvoiceToPaymentInvoice(record)
      return NextResponse.json({ data: invoiceJson(invoice) })
    } catch (e) {
      console.error("[api/receipt] record", e)
      const message = e instanceof Error ? e.message : "Could not load invoice"
      return NextResponse.json({ error: message }, { status: 404 })
    }
  }

  // Prefer short DB tokens (lyncr.app/r/Ab3xYz9kQm); fall back to old HMAC links.
  const short = await resolveReceiptToken(token)
  const verified = short
    ? { paymentIntentId: short.paymentIntentId, ownerUserId: short.ownerUserId }
    : verifyPaymentReceiptToken(token)
  if (!verified) {
    return NextResponse.json({ error: "Invoice link is invalid or expired" }, { status: 404 })
  }

  try {
    const invoice = await loadPaymentInvoice({
      paymentIntentId: verified.paymentIntentId,
      ownerUserId: verified.ownerUserId,
    })
    return NextResponse.json({ data: invoiceJson(invoice) })
  } catch (e) {
    console.error("[api/receipt]", e)
    const message = e instanceof Error ? e.message : "Could not load invoice"
    return NextResponse.json({ error: message }, { status: 404 })
  }
}
