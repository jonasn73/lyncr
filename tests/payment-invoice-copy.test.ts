import { describe, expect, it } from "vitest"
import {
  buildPaymentInvoiceEmailSubject,
  buildPaymentInvoiceSms,
  isReimbursementInvoice,
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
  it("does not say reimbursement for a normal Cash App receipt", () => {
    expect(isReimbursementInvoice(base)).toBe(false)
    expect(buildPaymentInvoiceEmailSubject(base)).toBe("Your Key Squad 502 receipt ($1.00)")
    expect(buildPaymentInvoiceSms(base)).not.toMatch(/reimbursement/i)
  })

  it("keeps reimbursement wording when vehicle/VIN is on the invoice", () => {
    const inv = { ...base, vehicleLabel: "2004 LINCOLN Aviator", vehicleVin: "1GNEK13Z" }
    expect(isReimbursementInvoice(inv)).toBe(true)
    expect(buildPaymentInvoiceEmailSubject(inv)).toMatch(/reimbursement/i)
  })
})
