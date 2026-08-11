// Resolve a public /r/{token} invoice (Stripe receipt or Venmo/cash record invoice).

import { verifyPaymentReceiptToken } from "@/lib/payment-receipt-token"
import { resolveReceiptToken } from "@/lib/payment-receipt-short-token"
import { loadPaymentInvoice, type PaymentInvoice } from "@/lib/payment-invoice"
import {
  getJobRecordInvoiceByToken,
  recordInvoiceToPaymentInvoice,
} from "@/lib/job-record-invoice"

/** Load invoice for a short token, HMAC token, or record-invoice token. */
export async function loadPublicInvoiceByToken(
  rawToken: string
): Promise<PaymentInvoice | null> {
  const token = decodeURIComponent(String(rawToken || "").trim())
  if (!token) return null

  // Paid-outside-Lyncr invoices (Venmo / cash) share the same /r/{token} URL.
  const record = await getJobRecordInvoiceByToken(token)
  if (record) {
    return recordInvoiceToPaymentInvoice(record)
  }

  const short = await resolveReceiptToken(token)
  const verified = short
    ? { paymentIntentId: short.paymentIntentId, ownerUserId: short.ownerUserId }
    : verifyPaymentReceiptToken(token)
  if (!verified) return null

  return loadPaymentInvoice({
    paymentIntentId: verified.paymentIntentId,
    ownerUserId: verified.ownerUserId,
  })
}
