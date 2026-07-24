// Build a customer-facing invoice model from a succeeded Stripe PaymentIntent.

import type Stripe from "stripe"
import { getUser } from "@/lib/db"
import { getAppUrl } from "@/lib/telnyx"
import { getPaymentSlipByIntentId } from "@/lib/payment-slips"
import { getOrCreateReceiptToken } from "@/lib/payment-receipt-short-token"
import { retrieveLyncrPaymentIntent } from "@/lib/stripe-payment-intent-retrieve"
import { getStripeClient } from "@/lib/stripe-config"

export type PaymentInvoiceLine = {
  label: string
  amountCents: number
}

export type PaymentInvoice = {
  invoiceNumber: string
  businessName: string
  businessPhone: string | null
  customerName: string | null
  paidAtIso: string
  paidAtLabel: string
  description: string
  lines: PaymentInvoiceLine[]
  subtotalCents: number
  taxCents: number
  tipCents: number
  totalCents: number
  paymentMethodLabel: string
  signaturePng: string | null
  receiptUrl: string
  paymentIntentId: string
}

function fmtUsd(cents: number): string {
  return (Math.max(0, cents) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  })
}

/** Short human invoice # from the PaymentIntent id (e.g. INV-3F2A9C1B). */
export function invoiceNumberFromIntentId(paymentIntentId: string): string {
  const bare = paymentIntentId.replace(/^pi_/, "").toUpperCase()
  const tail = bare.slice(-8) || bare.slice(0, 8) || "RECEIPT"
  return `INV-${tail}`
}

function formatPaidAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function paymentMethodLabelFromIntent(intent: Stripe.PaymentIntent): string {
  const charge =
    typeof intent.latest_charge === "object" && intent.latest_charge
      ? intent.latest_charge
      : null
  const details = charge?.payment_method_details
  if (!details) {
    if (intent.payment_method_types?.includes("card_present")) return "Card (tap / present)"
    if (intent.payment_method_types?.includes("card")) return "Card"
    return "Card payment"
  }
  if (details.type === "card" && details.card) {
    const brand = (details.card.brand || "Card").replace(/^\w/, (c) => c.toUpperCase())
    const last4 = details.card.last4 ? ` ···· ${details.card.last4}` : ""
    return `${brand}${last4}`
  }
  if (details.type === "card_present" && details.card_present) {
    const brand = (details.card_present.brand || "Card").replace(/^\w/, (c) =>
      c.toUpperCase()
    )
    const last4 = details.card_present.last4 ? ` ···· ${details.card_present.last4}` : ""
    return `${brand}${last4} (tap)`
  }
  if (details.type === "cashapp") return "Cash App"
  if (details.type === "link") return "Link"
  return details.type.replace(/_/g, " ")
}

/** Load invoice fields for a succeeded PI the shop owns. */
export async function loadPaymentInvoice(params: {
  paymentIntentId: string
  ownerUserId: string
}): Promise<PaymentInvoice> {
  const { intent, stripeConnectAccountId } = await retrieveLyncrPaymentIntent(
    params.paymentIntentId,
    { ownerUserId: params.ownerUserId }
  )
  if (intent.status !== "succeeded") {
    throw new Error("Payment is not complete yet")
  }
  const owner =
    (intent.metadata?.owner_user_id || intent.metadata?.acting_user_id || "").trim()
  // Token / send path always pass the shop owner id.
  if (owner && owner !== params.ownerUserId) {
    throw new Error("Not allowed to view this receipt")
  }

  // Expand latest_charge for card brand / last4 when missing.
  let full = intent
  if (!intent.latest_charge || typeof intent.latest_charge === "string") {
    try {
      const stripe = getStripeClient()
      full = await stripe.paymentIntents.retrieve(
        intent.id,
        { expand: ["latest_charge"] },
        stripeConnectAccountId ? { stripeAccount: stripeConnectAccountId } : undefined
      )
    } catch {
      full = intent
    }
  }

  const user = await getUser(params.ownerUserId)
  const businessName =
    (user?.business_name || "").trim() ||
    (user?.name || "").trim() ||
    "Your service provider"
  const businessPhone = (user?.phone || "").trim() || null

  const amountCents = full.amount_received || full.amount || 0
  const taxCents = Math.max(0, Number(full.metadata?.tax_cents || 0) || 0)
  const slip = await getPaymentSlipByIntentId(full.id)
  const tipCents = Math.max(
    0,
    slip?.tip_cents ?? (Number(full.metadata?.tip_cents || 0) || 0)
  )
  const note = (full.metadata?.note || "").trim() || "Service"
  const customerName =
    (full.metadata?.customer_name || "").trim() || null
  const serviceCents = Math.max(0, amountCents - taxCents)
  const lines: PaymentInvoiceLine[] = [
    { label: note, amountCents: serviceCents },
  ]
  if (taxCents > 0) lines.push({ label: "Tax", amountCents: taxCents })
  if (tipCents > 0) lines.push({ label: "Tip", amountCents: tipCents })

  const paidAtIso = full.created
    ? new Date(full.created * 1000).toISOString()
    : new Date().toISOString()
  // Short token → lyncr.app/r/Ab3xYz9kQm (fits in one SMS line).
  const shortToken = await getOrCreateReceiptToken({
    paymentIntentId: full.id,
    ownerUserId: (owner || params.ownerUserId).trim(),
  })
  const appUrl = getAppUrl().replace(/\/$/, "")

  return {
    invoiceNumber: invoiceNumberFromIntentId(full.id),
    businessName,
    businessPhone,
    customerName,
    paidAtIso,
    paidAtLabel: formatPaidAt(paidAtIso),
    description: note,
    lines,
    subtotalCents: serviceCents,
    taxCents,
    tipCents,
    totalCents: amountCents + tipCents,
    paymentMethodLabel: paymentMethodLabelFromIntent(full),
    signaturePng: slip?.signature_png || null,
    receiptUrl: `${appUrl}/r/${shortToken}`,
    paymentIntentId: full.id,
  }
}

export function formatInvoiceMoney(cents: number): string {
  return fmtUsd(cents)
}

/** Plain-text invoice for SMS (includes web invoice link). */
export function buildPaymentInvoiceSms(invoice: PaymentInvoice): string {
  const billTo = invoice.customerName ? `\nBill to: ${invoice.customerName}` : ""
  const lineBlock = invoice.lines
    .map((l) => `${l.label}: ${fmtUsd(l.amountCents)}`)
    .join("\n")
  return [
    `${invoice.businessName}`,
    `INVOICE ${invoice.invoiceNumber}`,
    `Paid ${invoice.paidAtLabel}`,
    billTo.trim(),
    "———",
    lineBlock,
    "———",
    `TOTAL PAID: ${fmtUsd(invoice.totalCents)}`,
    `Paid by: ${invoice.paymentMethodLabel}`,
    `View invoice: ${invoice.receiptUrl}`,
    "Thank you for your business!",
  ]
    .filter((line) => line.length > 0)
    .join("\n")
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/** HTML email that looks like a real invoice. */
export function buildPaymentInvoiceEmailHtml(invoice: PaymentInvoice): string {
  const greeting = invoice.customerName
    ? `Hi ${escapeHtml(invoice.customerName)},`
    : "Hi,"
  const rows = invoice.lines
    .map(
      (l) =>
        `<tr>
          <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;color:#334155;font-size:14px;">${escapeHtml(l.label)}</td>
          <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;text-align:right;color:#0f172a;font-size:14px;font-variant-numeric:tabular-nums;">${escapeHtml(fmtUsd(l.amountCents))}</td>
        </tr>`
    )
    .join("")
  const sig = invoice.signaturePng
    ? `<p style="margin:20px 0 6px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#94a3b8;">Customer signature</p>
       <img src="${invoice.signaturePng}" alt="Signature" width="280" style="max-width:100%;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:8px;" />`
    : ""
  const phone = invoice.businessPhone
    ? `<p style="margin:4px 0 0;font-size:13px;color:#64748b;">${escapeHtml(invoice.businessPhone)}</p>`
    : ""

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:28px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <tr><td style="background:#0f172a;padding:22px 24px;">
          <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#94a3b8;">Invoice</p>
          <p style="margin:8px 0 0;font-size:22px;font-weight:700;color:#ffffff;">${escapeHtml(invoice.businessName)}</p>
          ${phone}
        </td></tr>
        <tr><td style="padding:24px;">
          <p style="margin:0 0 4px;font-size:15px;color:#334155;">${greeting}</p>
          <p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:#64748b;">
            Thanks for your payment. Here is your itemized invoice.
          </p>
          <table width="100%" style="font-size:13px;margin-bottom:18px;">
            <tr>
              <td style="color:#94a3b8;padding:2px 0;">Invoice #</td>
              <td style="text-align:right;font-weight:600;color:#0f172a;">${escapeHtml(invoice.invoiceNumber)}</td>
            </tr>
            <tr>
              <td style="color:#94a3b8;padding:2px 0;">Date paid</td>
              <td style="text-align:right;color:#0f172a;">${escapeHtml(invoice.paidAtLabel)}</td>
            </tr>
            <tr>
              <td style="color:#94a3b8;padding:2px 0;">Payment method</td>
              <td style="text-align:right;color:#0f172a;">${escapeHtml(invoice.paymentMethodLabel)}</td>
            </tr>
            <tr>
              <td style="color:#94a3b8;padding:2px 0;">Status</td>
              <td style="text-align:right;font-weight:700;color:#059669;">PAID</td>
            </tr>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid #0f172a;">
            <tr>
              <td style="padding:12px 0 8px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;">Description</td>
              <td style="padding:12px 0 8px;text-align:right;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;">Amount</td>
            </tr>
            ${rows}
            <tr>
              <td style="padding:16px 0 0;font-size:16px;font-weight:800;color:#0f172a;">Total paid</td>
              <td style="padding:16px 0 0;text-align:right;font-size:16px;font-weight:800;color:#059669;font-variant-numeric:tabular-nums;">${escapeHtml(fmtUsd(invoice.totalCents))}</td>
            </tr>
          </table>
          ${sig}
          <p style="margin:24px 0 0;">
            <a href="${escapeHtml(invoice.receiptUrl)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 18px;border-radius:8px;">
              View invoice online
            </a>
          </p>
          <p style="margin:18px 0 0;font-size:12px;color:#94a3b8;line-height:1.4;">
            Ref: ${escapeHtml(invoice.paymentIntentId)}
          </p>
        </td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:11px;color:#94a3b8;">Sent via Lyncr</p>
    </td></tr>
  </table>
</body>
</html>`
}

export function buildPaymentInvoiceEmailText(invoice: PaymentInvoice): string {
  return [
    invoice.customerName ? `Hi ${invoice.customerName},` : "Hi,",
    "",
    `Thanks for your payment to ${invoice.businessName}.`,
    "",
    `INVOICE ${invoice.invoiceNumber}`,
    `Date paid: ${invoice.paidAtLabel}`,
    `Status: PAID`,
    `Payment method: ${invoice.paymentMethodLabel}`,
    "",
    ...invoice.lines.map((l) => `${l.label}: ${fmtUsd(l.amountCents)}`),
    "",
    `TOTAL PAID: ${fmtUsd(invoice.totalCents)}`,
    "",
    `View invoice: ${invoice.receiptUrl}`,
    `Ref: ${invoice.paymentIntentId}`,
  ].join("\n")
}
