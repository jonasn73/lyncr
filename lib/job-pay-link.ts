// Create + fulfill branded Collect Payment links (lyncr.app/pay/…) and SMS/email them.

import type Stripe from "stripe"
import { getAppUrl } from "@/lib/telnyx"
import { getStripeClient, isStripeConfigured } from "@/lib/stripe-config"
import { ensureStripeWalletPaymentMethodDomains } from "@/lib/stripe-payment-method-domains"
import {
  getUser,
  insertCollectPayLink,
  normalizePhoneNumberE164,
} from "@/lib/db"
import {
  is10DlcDeliveryWarning,
  sendTelnyxSms,
  TEN_DLC_BLOCK_USER_MESSAGE,
} from "@/lib/telnyx-sms"
import {
  commissionCentsFromCharge,
  confirmJobPaymentIntent,
  getJobPaymentContext,
  type JobPaymentContext,
} from "@/lib/job-payments"
import {
  createWalletTransaction,
  findWalletTransactionByPaymentIntent,
} from "@/lib/tech-wallet"

function fmtUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
}

function inviteSender(): string {
  return process.env.RESEND_FROM_EMAIL?.trim() || "Lyncr <receipts@lyncr.app>"
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/** Short opaque token for SMS (avoids pasting a long checkout.stripe.com URL). */
function makePayToken(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
  const bytes = new Uint8Array(10)
  crypto.getRandomValues(bytes)
  let out = ""
  for (let i = 0; i < bytes.length; i++) {
    out += alphabet[bytes[i]! % alphabet.length]
  }
  return out
}

export type CreatePayLinkResult = {
  /** Branded short URL on lyncr.app (customer-facing). */
  url: string
  sessionId: string
  chargeCents: number
  payToken: string
}

/** Create an embedded Checkout session + short lyncr.app/pay/{token} URL. */
export async function createCollectPayLinkCheckout(params: {
  actingUserId: string
  /** When set, ties payment to a job; otherwise walk-up / adhoc. */
  jobId?: string | null
  chargeCents: number
  subtotalCents: number
  taxCents: number
  note?: string | null
  customerName?: string | null
  customerEmail?: string | null
  lineSummary?: string | null
}): Promise<CreatePayLinkResult> {
  if (!isStripeConfigured()) {
    throw new Error("Stripe is not configured (STRIPE_SECRET_KEY)")
  }
  if (params.chargeCents < 50) {
    throw new Error("amount must be at least $0.50")
  }

  const jobId = (params.jobId ?? "").trim() || null
  let job: JobPaymentContext | null = null
  let ownerUserId = params.actingUserId
  let techUserId = params.actingUserId

  if (jobId) {
    job = await getJobPaymentContext(jobId)
    if (!job) throw new Error("Job not found")
    const isTech = job.assignedTechId === params.actingUserId
    const isOwner = job.ownerUserId === params.actingUserId
    if (!isTech && !isOwner) throw new Error("Not allowed to charge this job")
    ownerUserId = job.ownerUserId
    techUserId = job.assignedTechId || params.actingUserId
    if (!job.assignedTechId && isOwner) {
      techUserId = params.actingUserId
    }
    if (!techUserId) throw new Error("Assign a technician before sending a pay link")
  }

  const owner = await getUser(ownerUserId)
  const businessLabel =
    owner?.business_name?.trim() || owner?.name?.trim() || "Your service provider"
  const note = (params.note ?? "").trim().slice(0, 120) || (jobId ? "Job payment" : "Service payment")
  const customerName = (params.customerName ?? "").trim().slice(0, 80)
  const lineSummary = (params.lineSummary ?? "").trim().slice(0, 120) || note
  const commissionCents = jobId
    ? commissionCentsFromCharge(params.chargeCents)
    : params.chargeCents
  const appUrl = getAppUrl().replace(/\/$/, "")
  const checkoutType = jobId ? "job_payment_link" : "adhoc_payment_link"
  const lyncrKind = jobId ? "job_payment" : "adhoc_payment"
  const payToken = makePayToken()

  const stripe = getStripeClient()
  // Apple Pay / Google Pay on Embedded Checkout require the pay page domain registered.
  await ensureStripeWalletPaymentMethodDomains().catch((e) => {
    console.warn("[pay-link] wallet domain register:", e)
  })

  // Embedded Checkout keeps the customer on lyncr.app (no checkout.stripe.com URL bar).
  const session = await stripe.checkout.sessions.create({
    ui_mode: "embedded",
    mode: "payment",
    // Prefer card wallets (Apple Pay / Google Pay) when the device supports them.
    payment_method_options: {
      card: {
        request_three_d_secure: "automatic",
      },
    },
    client_reference_id: ownerUserId,
    customer_email: params.customerEmail?.trim() || undefined,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: params.chargeCents,
          product_data: {
            name: lineSummary,
            description:
              params.taxCents > 0
                ? `Includes ${fmtUsd(params.taxCents)} tax · ${businessLabel}`
                : `Secure payment to ${businessLabel}`,
          },
        },
      },
    ],
    metadata: {
      checkout_type: checkoutType,
      user_id: ownerUserId,
      acting_user_id: params.actingUserId,
      owner_user_id: ownerUserId,
      tech_user_id: techUserId,
      job_id: jobId || "",
      charge_cents: String(params.chargeCents),
      subtotal_cents: String(params.subtotalCents),
      tax_cents: String(params.taxCents),
      commission_cents: String(commissionCents),
      note,
      customer_name: customerName,
      business_label: businessLabel.slice(0, 80),
      pay_token: payToken,
      lyncr_kind: lyncrKind,
    },
    payment_intent_data: {
      description: customerName
        ? `${businessLabel} · ${customerName} · ${note}`
        : `${businessLabel} · ${note}`,
      metadata: {
        lyncr_kind: lyncrKind,
        job_id: jobId || "",
        owner_user_id: ownerUserId,
        tech_user_id: techUserId,
        acting_user_id: params.actingUserId,
        commission_cents: String(commissionCents),
        payment_method: "MANUAL_CARD",
        note,
        customer_name: customerName,
        subtotal_cents: String(params.subtotalCents),
        tax_cents: String(params.taxCents),
        pay_link: "1",
        pay_token: payToken,
      },
    },
    return_url: `${appUrl}/pay/thanks?session_id={CHECKOUT_SESSION_ID}`,
  })

  if (!session.id) throw new Error("Could not create payment session")

  // Best-effort short-token index (works even before migration via Stripe metadata search).
  await insertCollectPayLink({
    token: payToken,
    stripeSessionId: session.id,
    ownerUserId,
    actingUserId: params.actingUserId,
    jobId,
    chargeCents: params.chargeCents,
    businessLabel,
    customerName,
  }).catch((e) => {
    console.warn("[pay-link] collect_pay_links insert skipped:", e)
  })

  return {
    url: `${appUrl}/pay/${payToken}`,
    sessionId: session.id,
    chargeCents: params.chargeCents,
    payToken,
  }
}

/** After Checkout succeeds — create/settle wallet credit and complete the job. */
export async function fulfillCollectPayLinkFromCheckout(
  session: Stripe.Checkout.Session
): Promise<void> {
  const checkoutType = session.metadata?.checkout_type?.trim()
  if (checkoutType !== "job_payment_link" && checkoutType !== "adhoc_payment_link") return
  if (session.payment_status && session.payment_status !== "paid") return

  const piRef = session.payment_intent
  const paymentIntentId = typeof piRef === "string" ? piRef : piRef?.id
  if (!paymentIntentId) {
    console.error("[pay-link] checkout paid but missing payment_intent", session.id)
    return
  }

  const meta = session.metadata || {}
  const jobId = (meta.job_id || "").trim() || null
  const ownerUserId = (meta.owner_user_id || meta.user_id || "").trim()
  const techUserId = (meta.tech_user_id || ownerUserId).trim()
  const commissionCents = Math.max(
    0,
    Math.round(Number(meta.commission_cents) || Number(meta.charge_cents) || 0)
  )
  const walletUserId =
    checkoutType === "adhoc_payment_link" ? ownerUserId : techUserId || ownerUserId

  if (!walletUserId || commissionCents <= 0) {
    console.error("[pay-link] missing wallet user or commission", session.id)
    return
  }

  const existing = await findWalletTransactionByPaymentIntent(paymentIntentId)
  if (!existing) {
    await createWalletTransaction({
      userId: walletUserId,
      jobId: checkoutType === "job_payment_link" ? jobId : null,
      amountUsd: commissionCents / 100,
      status: "PENDING",
      paymentMethod: "MANUAL_CARD",
      stripePaymentIntentId: paymentIntentId,
    })
  }

  await confirmJobPaymentIntent(paymentIntentId)
}

/** Resolve a Checkout session from a short pay token (DB, then Stripe search). */
export async function resolvePayLinkSession(token: string): Promise<{
  session: Stripe.Checkout.Session
  businessLabel: string
  chargeCents: number
  customerName: string
} | null> {
  const key = token.trim()
  if (!key) return null
  const stripe = getStripeClient()

  let sessionId: string | null = null
  if (key.startsWith("cs_")) {
    sessionId = key
  } else {
    const { getCollectPayLinkByToken } = await import("@/lib/db")
    const row = await getCollectPayLinkByToken(key)
    if (row) sessionId = row.stripe_session_id
  }

  // Token → session is stored in collect_pay_links (scripts/113). No Stripe search API needed.
  if (!sessionId) return null

  const session = await stripe.checkout.sessions.retrieve(sessionId)
  const meta = session.metadata || {}
  const chargeCents = Math.max(
    0,
    Math.round(
      Number(meta.charge_cents) ||
        (typeof session.amount_total === "number" ? session.amount_total : 0) ||
        0
    )
  )
  return {
    session,
    businessLabel:
      (meta.business_label || "").trim() ||
      "Your service provider",
    chargeCents,
    customerName: (meta.customer_name || "").trim(),
  }
}

/** SMS or email a branded pay link. */
export async function sendCollectPayLink(params: {
  actingUserId: string
  channel: "email" | "sms"
  url: string
  chargeCents: number
  customerName?: string | null
  email?: string | null
  phone?: string | null
  businessLabel?: string | null
}): Promise<{ sent: boolean; error?: string }> {
  const businessLabel = (params.businessLabel || "Your service provider").trim() || "Your service provider"
  const customerName = (params.customerName ?? "").trim()
  const amount = fmtUsd(params.chargeCents)

  if (params.channel === "sms") {
    const toE164 = normalizePhoneNumberE164(params.phone ?? "")
    if (!toE164) return { sent: false, error: "Enter a valid phone number" }
    const greeting = customerName ? `Hi ${customerName} — ` : ""
    const text = [
      `${greeting}${businessLabel} sent you a secure payment request for ${amount}.`,
      "",
      "Pay here:",
      params.url,
    ].join("\n")
    const result = await sendTelnyxSms({
      userId: params.actingUserId,
      toE164,
      text,
    })
    if (!result.ok) return { sent: false, error: result.error || "SMS could not be sent" }
    if (is10DlcDeliveryWarning(result.delivery_warning)) {
      return {
        sent: false,
        error: result.delivery_warning || TEN_DLC_BLOCK_USER_MESSAGE,
      }
    }
    return { sent: true }
  }

  const email = (params.email ?? "").trim().toLowerCase()
  if (!email.includes("@") || email.length < 5) {
    return { sent: false, error: "Enter a valid email address" }
  }
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    return { sent: false, error: "Email is not configured (RESEND_API_KEY)" }
  }

  const greeting = customerName ? `Hi ${escapeHtml(customerName)},` : "Hi,"
  const html = `
<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:24px;">
  <table width="100%" style="max-width:480px;margin:0 auto;background:#1e293b;border-radius:12px;padding:24px;">
    <tr><td>
      <p style="margin:0 0 12px;font-size:14px;color:#94a3b8;">Payment request</p>
      <p style="margin:0 0 16px;font-size:16px;">${greeting}</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">
        <strong>${escapeHtml(businessLabel)}</strong> sent you a secure link to pay
        <strong style="color:#6ee7b7;">${escapeHtml(amount)}</strong>.
      </p>
      <p style="margin:24px 0;">
        <a href="${escapeHtml(params.url)}" style="display:inline-block;background:#10b981;color:#042f2e;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:10px;">
          Pay ${escapeHtml(amount)}
        </a>
      </p>
      <p style="margin:16px 0 0;font-size:12px;color:#64748b;">${escapeHtml(params.url)}</p>
    </td></tr>
  </table>
</body></html>`.trim()

  const text = [
    customerName ? `Hi ${customerName},` : "Hi,",
    "",
    `${businessLabel} sent you a secure payment request for ${amount}.`,
    "",
    "Pay here:",
    params.url,
  ].join("\n")

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
        subject: `Payment request ${amount} — ${businessLabel}`,
        html,
        text,
      }),
    })
    if (!res.ok) return { sent: false, error: "Email could not be sent" }
    return { sent: true }
  } catch {
    return { sent: false, error: "Email send failed — please try again" }
  }
}
