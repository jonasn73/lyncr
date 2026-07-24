// Send a paid invoice / receipt after Collect Payment (email via Resend, SMS via Telnyx).

import { getStripeClient } from "@/lib/stripe-config"
import { sendTelnyxSms } from "@/lib/telnyx-sms"
import { normalizePhoneNumberE164 } from "@/lib/db"
import {
  buildPaymentInvoiceEmailHtml,
  buildPaymentInvoiceEmailText,
  buildPaymentInvoiceSms,
  loadPaymentInvoice,
} from "@/lib/payment-invoice"
import { loadOwnedPaymentIntent } from "@/lib/payment-intent-access"

export { loadOwnedPaymentIntent } from "@/lib/payment-intent-access"

export type SendPaymentReceiptInput = {
  userId: string
  paymentIntentId: string
  channel: "email" | "sms"
  customerName?: string | null
  email?: string | null
  phone?: string | null
}

function inviteSender(): string {
  return process.env.RESEND_FROM_EMAIL?.trim() || "Lyncr <receipts@lyncr.app>"
}

/** @deprecated Prefer buildPaymentInvoiceSms — kept for any older imports/tests. */
export function buildPaymentReceiptSms(params: {
  customerName?: string
  amountCents: number
  taxCents: number
  tipCents?: number
  note: string
  businessLabel: string
}): string {
  const who = params.customerName?.trim() ? ` for ${params.customerName.trim()}` : ""
  const tax = params.taxCents > 0 ? ` (incl. $${(params.taxCents / 100).toFixed(2)} tax)` : ""
  const tip = (params.tipCents ?? 0) > 0 ? ` Tip $${((params.tipCents ?? 0) / 100).toFixed(2)}.` : ""
  const note = params.note.trim() ? `\n${params.note.trim()}` : ""
  const total = params.amountCents + Math.max(0, params.tipCents ?? 0)
  return `${params.businessLabel}: Payment received${who} — $${(total / 100).toFixed(2)}${tax}.${tip}${note}\nThank you!`
}

/** Email or text a real invoice for a collected payment. */
export async function sendPaymentReceipt(
  input: SendPaymentReceiptInput
): Promise<{ sent: boolean; error?: string; receiptUrl?: string }> {
  const { intent, stripeConnectAccountId } = await loadOwnedPaymentIntent(
    input.paymentIntentId,
    input.userId,
    { stripeConnectAccountId: null }
  )

  const shopOwnerId =
    (intent.metadata?.owner_user_id || intent.metadata?.acting_user_id || "").trim() ||
    input.userId

  // Persist contact on the PI for later lookup (does not change the charge).
  try {
    const stripe = getStripeClient()
    await stripe.paymentIntents.update(
      intent.id,
      {
        metadata: {
          ...intent.metadata,
          customer_name: (input.customerName ?? intent.metadata?.customer_name ?? "")
            .trim()
            .slice(0, 80),
          customer_email: (input.email ?? "").trim().slice(0, 120),
          customer_phone: normalizePhoneNumberE164(input.phone ?? "") || "",
          receipt_channel: input.channel,
        },
      },
      stripeConnectAccountId ? { stripeAccount: stripeConnectAccountId } : undefined
    )
  } catch (e) {
    console.warn("[payment-receipt] metadata update failed", e)
  }

  // Reload invoice after metadata update so name / contact show on the receipt.
  const invoice = await loadPaymentInvoice({
    paymentIntentId: intent.id,
    ownerUserId: shopOwnerId,
  })
  if ((input.customerName ?? "").trim()) {
    invoice.customerName = input.customerName!.trim()
  }

  if (input.channel === "sms") {
    const toE164 = normalizePhoneNumberE164(input.phone ?? "")
    if (!toE164) return { sent: false, error: "Enter a valid phone number" }
    const text = buildPaymentInvoiceSms(invoice)
    const result = await sendTelnyxSms({
      userId: input.userId,
      toE164,
      text,
    })
    if (!result.ok) return { sent: false, error: result.error || "SMS could not be sent" }
    return { sent: true, receiptUrl: invoice.receiptUrl }
  }

  const email = (input.email ?? "").trim().toLowerCase()
  if (!email.includes("@") || email.length < 5) {
    return { sent: false, error: "Enter a valid email address" }
  }

  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    return { sent: false, error: "Email is not configured (RESEND_API_KEY)" }
  }

  const html = buildPaymentInvoiceEmailHtml(invoice)
  const text = buildPaymentInvoiceEmailText(invoice)

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: inviteSender(),
        to: email,
        subject: `Invoice ${invoice.invoiceNumber} — ${invoice.businessName} — $${(invoice.totalCents / 100).toFixed(2)} paid`,
        html,
        text,
      }),
    })
    if (!res.ok) {
      return { sent: false, error: "Email could not be sent" }
    }
    return { sent: true, receiptUrl: invoice.receiptUrl }
  } catch {
    return { sent: false, error: "Email send failed — please try again" }
  }
}
