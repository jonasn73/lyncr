// GET /api/receipt/[token] — public invoice JSON for the customer receipt page.

import { NextRequest, NextResponse } from "next/server"
import { verifyPaymentReceiptToken } from "@/lib/payment-receipt-token"
import { loadPaymentInvoice } from "@/lib/payment-invoice"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token: raw } = await context.params
  const token = decodeURIComponent(String(raw || "").trim())
  const verified = verifyPaymentReceiptToken(token)
  if (!verified) {
    return NextResponse.json({ error: "Invoice link is invalid or expired" }, { status: 404 })
  }

  try {
    const invoice = await loadPaymentInvoice({
      paymentIntentId: verified.paymentIntentId,
      ownerUserId: verified.ownerUserId,
    })
    // Do not expose signature data URL on the public JSON if huge — page can still show lines.
    return NextResponse.json({
      data: {
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
      },
    })
  } catch (e) {
    console.error("[api/receipt]", e)
    const message = e instanceof Error ? e.message : "Could not load invoice"
    return NextResponse.json({ error: message }, { status: 404 })
  }
}
