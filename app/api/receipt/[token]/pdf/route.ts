// GET /api/receipt/[token]/pdf — downloadable invoice PDF for the customer.

import { NextRequest, NextResponse } from "next/server"
import { loadPublicInvoiceByToken } from "@/lib/load-public-invoice"
import {
  buildPaymentInvoicePdf,
  invoicePdfFilename,
} from "@/lib/payment-invoice-pdf"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token: raw } = await context.params
  try {
    const invoice = await loadPublicInvoiceByToken(raw)
    if (!invoice) {
      return NextResponse.json(
        { error: "Invoice link is invalid or expired" },
        { status: 404 }
      )
    }
    const bytes = await buildPaymentInvoicePdf(invoice)
    const filename = invoicePdfFilename(invoice)
    // Copy into a fresh ArrayBuffer so Response body typing stays happy.
    const body = Uint8Array.from(bytes)
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, max-age=300",
      },
    })
  } catch (e) {
    console.error("[api/receipt/pdf]", e)
    const message = e instanceof Error ? e.message : "Could not build PDF"
    return NextResponse.json({ error: message }, { status: 404 })
  }
}
