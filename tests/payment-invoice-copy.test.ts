import { describe, expect, it } from "vitest"
import {
  buildPaymentInvoiceEmailHtml,
  buildPaymentInvoiceEmailSubject,
  buildPaymentInvoiceEmailText,
  buildPaymentInvoiceSms,
  type PaymentInvoice,
} from "@/lib/payment-invoice"

const base: PaymentInvoice = {
  invoiceNumber: "INV-0ADDGZJ1",
  businessName: "Key Squad 502",
  businessPhone: "+15025571219",
  customerName: null,
  paidAtIso: "2026-08-13T00:11:00.000Z",
  paidAtLabel: "Aug 13, 2026, 12:11 AM",
  description: "Service",
  lines: [{ label: "Service", amountCents: 100 }],
  subtotalCents: 100,
  taxCents: 0,
  tipCents: 0,
  totalCents: 100,
  paymentMethodLabel: "Cash App",
  signaturePng: null,
  receiptUrl: "https://lyncr.app/r/test",
  paymentIntentId: "pi_test",
}

describe("payment invoice copy", () => {
  it("calls it an invoice, never reimbursement", () => {
    expect(buildPaymentInvoiceEmailSubject(base)).toBe(
      "Your Key Squad 502 invoice ($1.00)"
    )
    expect(buildPaymentInvoiceSms(base)).toContain("Your invoice — $1.00")
    expect(buildPaymentInvoiceEmailHtml(base)).toContain("Here is your invoice")
    expect(buildPaymentInvoiceEmailText(base)).toContain("Here is your invoice")
    expect(buildPaymentInvoiceEmailSubject(base)).not.toMatch(/reimbursement/i)
    expect(buildPaymentInvoiceSms(base)).not.toMatch(/reimbursement/i)
    expect(buildPaymentInvoiceEmailHtml(base)).not.toMatch(/reimbursement/i)
    expect(buildPaymentInvoiceEmailText(base)).not.toMatch(/reimbursement/i)
  })

  it("still does not say reimbursement when vehicle or VIN is on the invoice", () => {
    const inv = {
      ...base,
      vehicleLabel: "2004 LINCOLN Aviator",
      vehicleVin: "1GNEK13Z",
    }
    expect(buildPaymentInvoiceEmailSubject(inv)).toBe(
      "Your Key Squad 502 invoice ($1.00)"
    )
    expect(buildPaymentInvoiceEmailHtml(inv)).not.toMatch(/reimbursement/i)
    expect(buildPaymentInvoiceSms(inv)).not.toMatch(/reimbursement/i)
  })
})
