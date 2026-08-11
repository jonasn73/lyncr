// GET /api/receipt/[token] — public invoice JSON for the customer receipt page.

import { NextRequest, NextResponse } from "next/server"
import { loadPublicInvoiceByToken } from "@/lib/load-public-invoice"
import type { PaymentInvoice } from "@/lib/payment-invoice"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

function invoiceJson(invoice: PaymentInvoice) {
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
    // Same-origin PDF download — works on phones.
    pdfUrl: `/api/receipt/${encodeURIComponent(
      invoice.receiptUrl.split("/").pop() || ""
    )}/pdf`,
  }
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token: raw } = await context.params
  const token = decodeURIComponent(String(raw || "").trim())

  try {
    const invoice = await loadPublicInvoiceByToken(token)
    if (!invoice) {
      return NextResponse.json(
        { error: "Invoice link is invalid or expired" },
        { status: 404 }
      )
    }
    // Prefer the request token for the PDF path (short token as customer has it).
    const data = invoiceJson(invoice)
    data.pdfUrl = `/api/receipt/${encodeURIComponent(token)}/pdf`
    return NextResponse.json({ data })
  } catch (e) {
    console.error("[api/receipt]", e)
    const message = e instanceof Error ? e.message : "Could not load invoice"
    return NextResponse.json({ error: message }, { status: 404 })
  }
}
