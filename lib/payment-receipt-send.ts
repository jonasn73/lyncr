// Send a paid-invoice / receipt after Collect Payment (email via Resend, SMS via Telnyx).

import { getStripeClient } from "@/lib/stripe-config"
import { sendTelnyxSms } from "@/lib/telnyx-sms"
import { normalizePhoneNumberE164 } from "@/lib/db"
import { getPaymentSlipByIntent } from "@/lib/payment-slips"

export type SendPaymentReceiptInput = {
  userId: string
  paymentIntentId: string
  channel: "email" | "sms"
  customerName?: string | null
  email?: string | null
  phone?: string | null
}

function fmtUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function inviteSender(): string {
  return process.env.RESEND_FROM_EMAIL?.trim() || "Lyncr <receipts@lyncr.app>"
}

/** Build a short plain-text receipt for SMS. */
export function buildPaymentReceiptSms(params: {
  customerName?: string
  amountCents: number
  taxCents: number
  tipCents?: number
  note: string
  businessLabel: string
}): string {
  const who = params.customerName?.trim() ? ` for ${params.customerName.trim()}` : ""
  const tax =
    params.taxCents > 0 ? ` (incl. ${fmtUsd(params.taxCents)} tax)` : ""
  const tip =
    (params.tipCents ?? 0) > 0 ? ` Tip ${fmtUsd(params.tipCents!)}.` : ""
  const note = params.note.trim() ? `\n${params.note.trim()}` : ""
  const total = params.amountCents + Math.max(0, params.tipCents ?? 0)
  return `${params.businessLabel}: Payment received${who} — ${fmtUsd(total)}${tax}.${tip}${note}\nThank you!`
}

/** Load a succeeded PaymentIntent the acting user is allowed to receipt. */
export async function loadOwnedPaymentIntent(paymentIntentId: string, userId: string) {
  const stripe = getStripeClient()
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId)
  if (intent.status !== "succeeded") {
    throw new Error("Payment is not complete yet")
  }
  const owner = intent.metadata?.owner_user_id || intent.metadata?.acting_user_id || ""
  const tech = intent.metadata?.tech_user_id || ""
  if (owner !== userId && tech !== userId) {
    throw new Error("Not allowed to send a receipt for this payment")
  }
  return intent
}

/** Email or text a receipt for a collected payment. */
export async function sendPaymentReceipt(
  input: SendPaymentReceiptInput
): Promise<{ sent: boolean; error?: string }> {
  const intent = await loadOwnedPaymentIntent(input.paymentIntentId, input.userId)
  const amountCents = intent.amount_received || intent.amount || 0
  const taxCents = Math.max(0, Number(intent.metadata?.tax_cents || 0) || 0)
  const slip = await getPaymentSlipByIntent(intent.id, input.userId)
  const tipCents = Math.max(
    0,
    slip?.tip_cents ?? (Number(intent.metadata?.tip_cents || 0) || 0)
  )
  const signaturePng = slip?.signature_png || null
  const note = (intent.metadata?.note || "").trim() || "Service payment"
  const customerName = (input.customerName ?? intent.metadata?.customer_name ?? "").trim()
  const businessLabel = "Lyncr"
  const grandTotalCents = amountCents + tipCents

  // Persist contact on the PI for later lookup (does not change the charge).
  try {
    const stripe = getStripeClient()
    await stripe.paymentIntents.update(intent.id, {
      metadata: {
        ...intent.metadata,
        customer_name: customerName.slice(0, 80),
        customer_email: (input.email ?? "").trim().slice(0, 120),
        customer_phone: normalizePhoneNumberE164(input.phone ?? "") || "",
        receipt_channel: input.channel,
      },
    })
  } catch (e) {
    console.warn("[payment-receipt] metadata update failed", e)
  }

  if (input.channel === "sms") {
    const toE164 = normalizePhoneNumberE164(input.phone ?? "")
    if (!toE164) return { sent: false, error: "Enter a valid phone number" }
    const text = buildPaymentReceiptSms({
      customerName,
      amountCents,
      taxCents,
      tipCents,
      note,
      businessLabel,
    })
    const result = await sendTelnyxSms({
      userId: input.userId,
      toE164,
      text,
    })
    if (!result.ok) return { sent: false, error: result.error || "SMS could not be sent" }
    return { sent: true }
  }

  const email = (input.email ?? "").trim().toLowerCase()
  if (!email.includes("@") || email.length < 5) {
    return { sent: false, error: "Enter a valid email address" }
  }

  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    return { sent: false, error: "Email is not configured (RESEND_API_KEY)" }
  }

  const greeting = customerName ? `Hi ${escapeHtml(customerName)},` : "Hi,"
  const taxLine =
    taxCents > 0
      ? `<tr><td style="padding:4px 0;color:#64748b;">Tax</td><td style="padding:4px 0;text-align:right;color:#64748b;">${escapeHtml(fmtUsd(taxCents))}</td></tr>`
      : ""
  const tipLine =
    tipCents > 0
      ? `<tr><td style="padding:4px 0;color:#64748b;">Tip</td><td style="padding:4px 0;text-align:right;color:#64748b;">${escapeHtml(fmtUsd(tipCents))}</td></tr>`
      : ""
  const sigBlock = signaturePng
    ? `<p style="margin:16px 0 4px;font-size:12px;color:#94a3b8;">Customer signature</p>
       <img src="${signaturePng}" alt="Signature" width="280" style="max-width:100%;background:#fff;border-radius:8px;padding:8px;" />`
    : ""
  const html = `
<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:24px;">
  <table width="100%" style="max-width:480px;margin:0 auto;background:#1e293b;border-radius:12px;padding:24px;">
    <tr><td>
      <p style="margin:0 0 12px;font-size:14px;color:#94a3b8;">Payment receipt</p>
      <p style="margin:0 0 16px;font-size:16px;">${greeting}</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">
        Thanks for your payment. Here is your receipt from <strong>${escapeHtml(businessLabel)}</strong>.
      </p>
      <table width="100%" style="font-size:14px;border-collapse:collapse;">
        <tr><td style="padding:4px 0;color:#94a3b8;">Description</td><td style="padding:4px 0;text-align:right;">${escapeHtml(note)}</td></tr>
        ${taxLine}
        ${tipLine}
        <tr><td style="padding:12px 0 0;font-weight:700;color:#6ee7b7;">Total paid</td><td style="padding:12px 0 0;text-align:right;font-weight:700;color:#6ee7b7;">${escapeHtml(fmtUsd(grandTotalCents))}</td></tr>
      </table>
      ${sigBlock}
      <p style="margin:20px 0 0;font-size:12px;color:#64748b;">Ref: ${escapeHtml(intent.id)}</p>
    </td></tr>
  </table>
</body></html>`.trim()

  const text = [
    customerName ? `Hi ${customerName},` : "Hi,",
    "",
    `Thanks for your payment to ${businessLabel}.`,
    `Description: ${note}`,
    taxCents > 0 ? `Tax: ${fmtUsd(taxCents)}` : null,
    tipCents > 0 ? `Tip: ${fmtUsd(tipCents)}` : null,
    `Total paid: ${fmtUsd(grandTotalCents)}`,
    `Ref: ${intent.id}`,
  ]
    .filter(Boolean)
    .join("\n")

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
        subject: `Receipt — ${fmtUsd(grandTotalCents)}`,
        html,
        text,
      }),
    })
    if (!res.ok) {
      return { sent: false, error: "Email could not be sent" }
    }
    return { sent: true }
  } catch {
    return { sent: false, error: "Email send failed — please try again" }
  }
}
