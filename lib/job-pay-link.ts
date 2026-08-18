// Create + fulfill branded Collect Payment links (lyncr.app/pay/…) and SMS/email them.

import type Stripe from "stripe"
import { getAppUrl } from "@/lib/telnyx"
import { getStripeClient, isStripeConfigured } from "@/lib/stripe-config"
import { ensureStripeWalletPaymentMethodDomains } from "@/lib/stripe-payment-method-domains"
import {
  COLLECT_CHECKOUT_EXCLUDED_PAYMENT_METHOD_TYPES,
  COLLECT_CHECKOUT_PAYMENT_METHOD_TYPES,
  COLLECT_CHECKOUT_PAYMENT_METHOD_TYPES_WITH_VENMO,
  isUnsupportedPaymentMethodError,
} from "@/lib/stripe-collect-payment-methods"
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
  /** Empty until the customer confirms tip and Checkout is created. */
  sessionId: string
  /** Service + tax only (tip chosen later on /pay/{token}). */
  chargeCents: number
  payToken: string
  /** True when Venmo was accepted on this Checkout session. */
  venmoIncluded?: boolean
  /** True when Checkout used Stripe dynamic payment methods (Dashboard-driven). */
  dynamicMethods?: boolean
}

/**
 * Create a branded pay link WITHOUT a Stripe Checkout session yet.
 * Customer opens /pay/{token}, picks tip, then we create Checkout for base+tip.
 */
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
  /** Phone the link was / will be texted to — used for auto SMS receipt. */
  customerPhone?: string | null
  lineSummary?: string | null
}): Promise<CreatePayLinkResult> {
  if (!isStripeConfigured()) {
    throw new Error("Stripe is not configured (STRIPE_SECRET_KEY)")
  }
  if (params.chargeCents < 50) {
    throw new Error("amount must be at least $0.50")
  }

  const jobId = (params.jobId ?? "").trim() || null
  let ownerUserId = params.actingUserId
  let techUserId = params.actingUserId

  if (jobId) {
    const job = await getJobPaymentContext(jobId)
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

  // Ensure Connect is ready before we SMS a link the customer cannot pay on.
  const { requireConnectReady } = await import("@/lib/stripe-connect")
  await requireConnectReady(ownerUserId)

  const owner = await getUser(ownerUserId)
  const businessLabel =
    owner?.business_name?.trim() || owner?.name?.trim() || "Your service provider"
  const note = (params.note ?? "").trim().slice(0, 120) || (jobId ? "Job payment" : "Service payment")
  const customerName = (params.customerName ?? "").trim().slice(0, 80)
  const lineSummary = (params.lineSummary ?? "").trim().slice(0, 120) || note
  const appUrl = getAppUrl().replace(/\/$/, "")
  const payToken = makePayToken()
  const customerPhone = normalizePhoneNumberE164(params.customerPhone ?? "") || ""
  const customerEmail = (params.customerEmail ?? "").trim().toLowerCase().slice(0, 160)

  // No Stripe session yet — tip step comes first on the branded page.
  const inserted = await insertCollectPayLink({
    token: payToken,
    stripeSessionId: null,
    ownerUserId,
    actingUserId: params.actingUserId,
    techUserId,
    jobId,
    chargeCents: params.chargeCents,
    subtotalCents: params.subtotalCents,
    taxCents: params.taxCents,
    tipCents: 0,
    note,
    lineSummary,
    businessLabel,
    customerName,
    customerPhone,
    customerEmail,
  }).catch((e) => {
    console.warn("[pay-link] collect_pay_links insert failed:", e)
    throw new Error(
      "Could not save pay link. Run scripts/135-collect-pay-links-tip-receipt.sql in Neon, then try again."
    )
  })
  if (!inserted) {
    throw new Error(
      "Could not save pay link. Run scripts/113-collect-pay-links.sql and scripts/135-collect-pay-links-tip-receipt.sql in Neon, then try again."
    )
  }

  return {
    url: `${appUrl}/pay/${payToken}`,
    sessionId: "",
    chargeCents: params.chargeCents,
    payToken,
  }
}

/** Create embedded Checkout for base + tip after the customer confirms tip. */
export async function finalizeCollectPayLinkWithTip(params: {
  token: string
  tipCents: number
}): Promise<{
  clientSecret: string
  sessionId: string
  chargeCents: number
  tipCents: number
  baseCents: number
  businessLabel: string
  customerName: string
  publishableKey: string
  stripeAccountId: string | null
  venmoIncluded: boolean
  dynamicMethods: boolean
}> {
  if (!isStripeConfigured()) {
    throw new Error("Stripe is not configured (STRIPE_SECRET_KEY)")
  }

  const { getCollectPayLinkByToken, attachCollectPayLinkCheckoutSession } = await import("@/lib/db")
  const row = await getCollectPayLinkByToken(params.token)
  if (!row) throw new Error("This payment link is invalid or has expired.")

  // Already has an open Checkout session — return it (idempotent refresh).
  if (row.stripe_session_id) {
    const resolved = await resolvePayLinkSession(params.token)
    if (resolved?.session.client_secret) {
      const { getStripePublishableKey } = await import("@/lib/stripe-config")
      const publishableKey = getStripePublishableKey()
      if (!publishableKey) throw new Error("Payments are not configured (publishable key).")
      return {
        clientSecret: resolved.session.client_secret,
        sessionId: resolved.session.id,
        chargeCents: resolved.chargeCents,
        tipCents: row.tip_cents,
        baseCents: Math.max(0, row.subtotal_cents + row.tax_cents) || resolved.chargeCents,
        businessLabel: resolved.businessLabel,
        customerName: resolved.customerName,
        publishableKey,
        stripeAccountId: resolved.stripeConnectAccountId,
        venmoIncluded: Boolean(resolved.session.payment_method_types?.includes("venmo")),
        dynamicMethods: true,
      }
    }
    if (resolved?.session.payment_status === "paid") {
      throw new Error("This payment link was already paid.")
    }
  }

  const tipCents = Math.max(0, Math.round(params.tipCents))
  const baseCents = Math.max(
    0,
    Math.round(
      (row.subtotal_cents || 0) + (row.tax_cents || 0) || row.charge_cents || 0
    )
  )
  if (baseCents < 50) throw new Error("amount must be at least $0.50")
  const chargeCents = baseCents + tipCents
  if (chargeCents < 50) throw new Error("amount must be at least $0.50")

  const ownerUserId = (row.owner_user_id || "").trim()
  if (!ownerUserId) throw new Error("Pay link is missing the business account.")
  const actingUserId = (row.acting_user_id || ownerUserId).trim()
  const techUserId = (row.tech_user_id || actingUserId || ownerUserId).trim()
  const jobId = (row.job_id || "").trim() || null
  const note = (row.note || "").trim() || (jobId ? "Job payment" : "Service payment")
  const lineSummary = (row.line_summary || "").trim() || note
  const customerName = (row.customer_name || "").trim().slice(0, 80)
  const customerEmail = (row.customer_email || "").trim().toLowerCase() || undefined
  const customerPhone = normalizePhoneNumberE164(row.customer_phone || "") || ""
  const businessLabel = (row.business_label || "").trim() || "Your service provider"
  const subtotalCents = Math.max(0, Math.round(row.subtotal_cents || baseCents - (row.tax_cents || 0)))
  const taxCents = Math.max(0, Math.round(row.tax_cents || 0))
  const commissionCents = jobId ? commissionCentsFromCharge(chargeCents) : chargeCents
  const checkoutType = jobId ? "job_payment_link" : "adhoc_payment_link"
  const lyncrKind = jobId ? "job_payment" : "adhoc_payment"
  const appUrl = getAppUrl().replace(/\/$/, "")
  const payToken = row.token

  const { requireConnectReady, computeLyncrApplicationFeeCents, connectDirectChargeOptions } =
    await import("@/lib/stripe-connect")
  const connect = await requireConnectReady(ownerUserId)
  const applicationFeeAmount = computeLyncrApplicationFeeCents(chargeCents)

  const stripe = getStripeClient()
  const connectOpts = connectDirectChargeOptions(connect.accountId)

  await ensureStripeWalletPaymentMethodDomains({
    stripeAccount: connect.accountId,
  }).catch((e) => {
    console.warn("[pay-link] wallet domain register (connect):", e)
  })
  await ensureStripeWalletPaymentMethodDomains().catch((e) => {
    console.warn("[pay-link] wallet domain register (platform):", e)
  })

  const tipNote =
    tipCents > 0 ? `Includes ${fmtUsd(tipCents)} tip` : "No tip"
  const taxNote =
    taxCents > 0 ? ` · Includes ${fmtUsd(taxCents)} tax` : ""

  const checkoutBase = {
    ui_mode: "embedded" as const,
    mode: "payment" as const,
    payment_method_options: {
      card: {
        request_three_d_secure: "automatic" as const,
      },
    },
    excluded_payment_method_types: [
      ...COLLECT_CHECKOUT_EXCLUDED_PAYMENT_METHOD_TYPES,
    ],
    client_reference_id: ownerUserId,
    customer_email: customerEmail,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: chargeCents,
          product_data: {
            name: lineSummary,
            description: `${tipNote}${taxNote} · ${businessLabel}`.slice(0, 500),
          },
        },
      },
    ],
    metadata: {
      checkout_type: checkoutType,
      user_id: ownerUserId,
      acting_user_id: actingUserId,
      owner_user_id: ownerUserId,
      tech_user_id: techUserId,
      job_id: jobId || "",
      charge_cents: String(chargeCents),
      subtotal_cents: String(subtotalCents),
      tax_cents: String(taxCents),
      tip_cents: String(tipCents),
      tip_included_in_amount: tipCents > 0 ? "1" : "0",
      commission_cents: String(commissionCents),
      note,
      customer_name: customerName,
      customer_phone: customerPhone,
      business_label: businessLabel.slice(0, 80),
      pay_token: payToken,
      lyncr_kind: lyncrKind,
      stripe_connect_account_id: connect.accountId,
      lyncr_application_fee_cents: String(applicationFeeAmount),
    },
    payment_intent_data: {
      application_fee_amount: applicationFeeAmount,
      description: customerName
        ? `${businessLabel} · ${customerName} · ${note}`
        : `${businessLabel} · ${note}`,
      metadata: {
        lyncr_kind: lyncrKind,
        job_id: jobId || "",
        owner_user_id: ownerUserId,
        tech_user_id: techUserId,
        acting_user_id: actingUserId,
        commission_cents: String(commissionCents),
        payment_method: "MANUAL_CARD",
        note,
        customer_name: customerName,
        customer_phone: customerPhone,
        subtotal_cents: String(subtotalCents),
        tax_cents: String(taxCents),
        tip_cents: String(tipCents),
        tip_included_in_amount: tipCents > 0 ? "1" : "0",
        pay_link: "1",
        pay_token: payToken,
        stripe_connect_account_id: connect.accountId,
        lyncr_application_fee_cents: String(applicationFeeAmount),
      },
    },
    return_url: `${appUrl}/pay/thanks?session_id={CHECKOUT_SESSION_ID}`,
  }

  let session: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>
  let venmoIncluded = false
  let dynamicMethods = false

  try {
    session = await stripe.checkout.sessions.create(
      {
        ...checkoutBase,
      },
      connectOpts
    )
    dynamicMethods = true
    venmoIncluded = Boolean(session.payment_method_types?.includes("venmo"))
  } catch (dynamicErr) {
    console.warn(
      "[pay-link] dynamic payment methods failed — falling back to explicit list:",
      dynamicErr
    )
    try {
      const { excluded_payment_method_types: _excluded, ...withoutExclude } = checkoutBase
      void _excluded
      session = await stripe.checkout.sessions.create(
        {
          ...withoutExclude,
          payment_method_types: [
            ...COLLECT_CHECKOUT_PAYMENT_METHOD_TYPES_WITH_VENMO,
          ] as Stripe.Checkout.SessionCreateParams.PaymentMethodType[],
        },
        connectOpts
      )
      venmoIncluded = true
    } catch (e) {
      if (!isUnsupportedPaymentMethodError(e)) throw e
      console.warn("[pay-link] Venmo/PM rejected — retrying without Venmo:", e)
      const { excluded_payment_method_types: _excluded2, ...withoutExclude2 } = checkoutBase
      void _excluded2
      session = await stripe.checkout.sessions.create(
        {
          ...withoutExclude2,
          payment_method_types: [
            ...COLLECT_CHECKOUT_PAYMENT_METHOD_TYPES,
          ] as Stripe.Checkout.SessionCreateParams.PaymentMethodType[],
        },
        connectOpts
      )
    }
  }

  if (!session.id || !session.client_secret) {
    throw new Error("Could not create payment session")
  }

  await attachCollectPayLinkCheckoutSession({
    token: payToken,
    stripeSessionId: session.id,
    chargeCents,
    tipCents,
  }).catch((e) => {
    console.warn("[pay-link] attach session failed:", e)
  })

  // Also save tip on payment_slips once we know the PI (after pay) — metadata already has tip.

  const { getStripePublishableKey } = await import("@/lib/stripe-config")
  const publishableKey = getStripePublishableKey()
  if (!publishableKey) throw new Error("Payments are not configured (publishable key).")

  return {
    clientSecret: session.client_secret,
    sessionId: session.id,
    chargeCents,
    tipCents,
    baseCents,
    businessLabel,
    customerName,
    publishableKey,
    stripeAccountId: connect.accountId,
    venmoIncluded,
    dynamicMethods,
  }
}

/** After Checkout succeeds — create/settle wallet credit, save email, auto-send receipt. */
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
  const payToken = (meta.pay_token || "").trim()
  const commissionCents = Math.max(
    0,
    Math.round(Number(meta.commission_cents) || Number(meta.charge_cents) || 0)
  )
  const tipCents = Math.max(0, Math.round(Number(meta.tip_cents) || 0))
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
      customerPhone: (meta.customer_phone || "").trim() || null,
      customerName: (meta.customer_name || "").trim() || null,
    })
  }

  await confirmJobPaymentIntent(paymentIntentId, {
    stripeConnectAccountId: (meta.stripe_connect_account_id || "").trim() || null,
  })

  // Persist tip on payment_slips (same as in-person Collect) for invoice line items.
  if (tipCents > 0 && ownerUserId) {
    try {
      const { upsertPaymentSlip } = await import("@/lib/payment-slips")
      await upsertPaymentSlip({
        userId: ownerUserId,
        paymentIntentId,
        tipCents,
        tipPaymentIntentId: null,
        signaturePng: null,
        stripeConnectAccountId: (meta.stripe_connect_account_id || "").trim() || null,
      })
    } catch (e) {
      console.warn("[pay-link] tip slip save failed:", e)
    }
  }

  // Grab email Checkout collected and tie it to job / CRM / phone contact.
  await persistPayLinkCustomerEmailFromSession(session).catch((e) => {
    console.warn("[pay-link] email persist failed:", e)
  })

  // Auto email + SMS receipt (no owner action required).
  await autoSendPayLinkReceipts({
    session,
    paymentIntentId,
    ownerUserId,
    actingUserId: (meta.acting_user_id || ownerUserId).trim(),
    payToken,
  }).catch((e) => {
    console.warn("[pay-link] auto receipt failed:", e)
  })
}

/** Save Checkout email onto the job + CRM customer (matched by pay-link phone). */
async function persistPayLinkCustomerEmailFromSession(
  session: Stripe.Checkout.Session
): Promise<void> {
  const emailRaw =
    session.customer_details?.email?.trim() ||
    session.customer_email?.trim() ||
    ""
  const email = emailRaw.toLowerCase().slice(0, 160)
  if (!email.includes("@")) return

  const meta = session.metadata || {}
  const jobId = (meta.job_id || "").trim()
  const ownerUserId = (meta.owner_user_id || meta.user_id || "").trim()
  const customerName = (meta.customer_name || session.customer_details?.name || "").trim()
  let phone = normalizePhoneNumberE164(meta.customer_phone || "") || ""

  // Prefer phone stored on the pay-link row (SMS destination).
  const payToken = (meta.pay_token || "").trim()
  if ((!phone || !ownerUserId) && payToken) {
    const { getCollectPayLinkByTokenAny } = await import("@/lib/db")
    const row = await getCollectPayLinkByTokenAny(payToken)
    if (row) {
      if (!phone) phone = normalizePhoneNumberE164(row.customer_phone) || ""
    }
  }

  if (jobId) {
    const { patchJobCustomerEmailFromPayLink } = await import("@/lib/db")
    await patchJobCustomerEmailFromPayLink({ jobId, email })
  }

  // Mirror onto PaymentIntent metadata for invoice / send-receipt.
  try {
    const stripe = getStripeClient()
    const connectAccountId = (meta.stripe_connect_account_id || "").trim() || null
    const piRef = session.payment_intent
    const paymentIntentId = typeof piRef === "string" ? piRef : piRef?.id
    if (paymentIntentId) {
      await stripe.paymentIntents.update(
        paymentIntentId,
        {
          metadata: {
            customer_email: email,
            ...(phone ? { customer_phone: phone } : {}),
          },
        },
        connectAccountId ? { stripeAccount: connectAccountId } : undefined
      )
    }
  } catch (e) {
    console.warn("[pay-link] PI email metadata update failed:", e)
  }

  if (ownerUserId && phone) {
    try {
      const { upsertCustomerForUser } = await import("@/lib/db")
      await upsertCustomerForUser({
        userId: ownerUserId,
        phoneE164: phone,
        displayName: customerName || "Customer",
        companyName: "",
        addressLine1: "",
        addressLine2: "",
        city: "",
        region: "",
        postalCode: "",
        country: "US",
        notes: "",
        email,
      })
    } catch (e) {
      console.warn("[pay-link] CRM email upsert failed:", e)
    }
  }
}

/** After pay-link success: email Checkout address + SMS the phone the link was texted to. */
async function autoSendPayLinkReceipts(params: {
  session: Stripe.Checkout.Session
  paymentIntentId: string
  ownerUserId: string
  actingUserId: string
  payToken: string
}): Promise<void> {
  if (!params.ownerUserId || !params.paymentIntentId) return

  const meta = params.session.metadata || {}
  let phone = normalizePhoneNumberE164(meta.customer_phone || "") || ""
  let customerName = (meta.customer_name || "").trim()
  const email =
    (
      params.session.customer_details?.email?.trim() ||
      params.session.customer_email?.trim() ||
      meta.customer_email ||
      ""
    )
      .toLowerCase()
      .slice(0, 160)

  if (params.payToken) {
    const { getCollectPayLinkByTokenAny, markCollectPayLinkReceiptSent } = await import(
      "@/lib/db"
    )
    const row = await getCollectPayLinkByTokenAny(params.payToken)
    if (row?.receipt_sent_at) return
    if (row) {
      if (!phone) phone = normalizePhoneNumberE164(row.customer_phone) || ""
      if (!customerName) customerName = (row.customer_name || "").trim()
    }
    const claimed = await markCollectPayLinkReceiptSent(params.payToken)
    if (!claimed) {
      // Concurrent webhook already claimed, or migration 135 not applied yet.
      const again = await getCollectPayLinkByTokenAny(params.payToken)
      if (again?.receipt_sent_at) return
      try {
        const stripe = getStripeClient()
        const connectAccountId =
          (params.session.metadata?.stripe_connect_account_id || "").trim() || null
        const intent = await stripe.paymentIntents.retrieve(
          params.paymentIntentId,
          connectAccountId ? { stripeAccount: connectAccountId } : undefined
        )
        if (intent.metadata?.receipt_auto_sent === "1") return
        await stripe.paymentIntents.update(
          params.paymentIntentId,
          {
            metadata: {
              ...intent.metadata,
              receipt_auto_sent: "1",
            },
          },
          connectAccountId ? { stripeAccount: connectAccountId } : undefined
        )
      } catch (e) {
        console.warn("[pay-link] receipt_auto_sent lock failed:", e)
      }
    }
  } else {
    return
  }

  const { sendPaymentReceipt } = await import("@/lib/payment-receipt-send")
  const senderId = params.actingUserId || params.ownerUserId

  if (email.includes("@")) {
    const result = await sendPaymentReceipt({
      userId: senderId,
      paymentIntentId: params.paymentIntentId,
      channel: "email",
      customerName: customerName || undefined,
      email,
    })
    if (!result.sent) {
      console.warn("[pay-link] auto receipt email failed:", result.error)
    }
  }

  if (phone) {
    const result = await sendPaymentReceipt({
      userId: senderId,
      paymentIntentId: params.paymentIntentId,
      channel: "sms",
      customerName: customerName || undefined,
      phone,
    })
    if (!result.sent) {
      console.warn("[pay-link] auto receipt SMS failed:", result.error)
    }
  }
}

/**
 * Backup when checkout.session.completed is missed: create PENDING from PaymentIntent
 * metadata (pay links always set pay_link=1), then settle + receipt.
 */
export async function fulfillCollectPayLinkFromPaymentIntent(
  intent: Stripe.PaymentIntent
): Promise<void> {
  const meta = intent.metadata || {}
  if (meta.pay_link !== "1") return
  const kind = (meta.lyncr_kind || "").trim()
  if (kind !== "job_payment" && kind !== "adhoc_payment") return
  if (intent.status !== "succeeded") return

  const jobId = (meta.job_id || "").trim() || null
  const ownerUserId = (meta.owner_user_id || "").trim()
  const techUserId = (meta.tech_user_id || ownerUserId).trim()
  const commissionCents = Math.max(
    0,
    Math.round(Number(meta.commission_cents) || intent.amount || 0)
  )
  const tipCents = Math.max(0, Math.round(Number(meta.tip_cents) || 0))
  const walletUserId = kind === "adhoc_payment" ? ownerUserId : techUserId || ownerUserId
  if (!walletUserId || commissionCents <= 0) {
    console.error("[pay-link] PI missing wallet user or commission", intent.id)
    return
  }

  const existing = await findWalletTransactionByPaymentIntent(intent.id)
  if (!existing) {
    await createWalletTransaction({
      userId: walletUserId,
      jobId: kind === "job_payment" ? jobId : null,
      amountUsd: commissionCents / 100,
      status: "PENDING",
      paymentMethod: "MANUAL_CARD",
      stripePaymentIntentId: intent.id,
      customerPhone: (meta.customer_phone || "").trim() || null,
      customerName: (meta.customer_name || "").trim() || null,
    })
  }

  await confirmJobPaymentIntent(intent.id, {
    stripeConnectAccountId: (meta.stripe_connect_account_id || "").trim() || null,
  })

  if (tipCents > 0 && ownerUserId) {
    try {
      const { upsertPaymentSlip } = await import("@/lib/payment-slips")
      await upsertPaymentSlip({
        userId: ownerUserId,
        paymentIntentId: intent.id,
        tipCents,
        tipPaymentIntentId: null,
        signaturePng: null,
        stripeConnectAccountId: (meta.stripe_connect_account_id || "").trim() || null,
      })
    } catch (e) {
      console.warn("[pay-link] tip slip save (PI) failed:", e)
    }
  }

  // Prefer full Checkout session path for email + receipts when we can load it.
  const payToken = (meta.pay_token || "").trim()
  if (payToken) {
    try {
      const { getCollectPayLinkByTokenAny } = await import("@/lib/db")
      const row = await getCollectPayLinkByTokenAny(payToken)
      const sessionId = row?.stripe_session_id
      if (sessionId) {
        const stripe = getStripeClient()
        const connectAccountId = (meta.stripe_connect_account_id || "").trim() || null
        const session = await stripe.checkout.sessions.retrieve(
          sessionId,
          connectAccountId ? { stripeAccount: connectAccountId } : undefined
        )
        if (session.payment_status === "paid") {
          await persistPayLinkCustomerEmailFromSession(session).catch(() => null)
          await autoSendPayLinkReceipts({
            session,
            paymentIntentId: intent.id,
            ownerUserId,
            actingUserId: (meta.acting_user_id || ownerUserId).trim(),
            payToken,
          }).catch(() => null)
          return
        }
      }
    } catch (e) {
      console.warn("[pay-link] PI backup session receipt path failed:", e)
    }
  }
}

export type CollectPayLinkStatus = {
  token: string
  url: string
  stripeSessionId: string
  jobId: string | null
  chargeCents: number
  customerName: string
  businessLabel: string
  createdAt: string
  expiresAt: string
  /** Stripe Checkout payment_status (or expired). */
  paymentStatus: "paid" | "unpaid" | "no_payment_required" | "expired" | "unknown"
  walletSettled: boolean
  /** True when we just wrote/settled a wallet row during this sync. */
  fulfilledNow: boolean
}

/** Pull latest Stripe status for a stored link; credit wallet if the customer already paid. */
export async function syncCollectPayLinkStatus(params: {
  token?: string | null
  stripeSessionId?: string | null
}): Promise<CollectPayLinkStatus | null> {
  if (!isStripeConfigured()) return null
  const stripe = getStripeClient()
  const appUrl = getAppUrl().replace(/\/$/, "")

  let token = (params.token ?? "").trim()
  let sessionId = (params.stripeSessionId ?? "").trim()

  const { getCollectPayLinkByToken, getCollectPayLinkBySessionId, getCollectPayLinkByTokenAny } =
    await import("@/lib/db")
  let row =
    (sessionId ? await getCollectPayLinkBySessionId(sessionId) : null) ||
    (token ? await getCollectPayLinkByToken(token) : null) ||
    (token ? await getCollectPayLinkByTokenAny(token) : null)

  if (row) {
    token = row.token
    sessionId = row.stripe_session_id || ""
  }

  // Tip not chosen yet — no Checkout session. Still report Waiting so owner UI works.
  if (!sessionId && row) {
    const expired = new Date(row.expires_at).getTime() < Date.now()
    return {
      token: row.token,
      url: `${appUrl}/pay/${row.token}`,
      stripeSessionId: "",
      jobId: row.job_id,
      chargeCents: row.charge_cents,
      customerName: row.customer_name,
      businessLabel: row.business_label,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      paymentStatus: expired ? "expired" : "unpaid",
      walletSettled: false,
      fulfilledNow: false,
    }
  }
  if (!sessionId) return null

  let connectAccountId: string | null = null
  if (row?.owner_user_id) {
    const { getUserStripeConnect } = await import("@/lib/db")
    const connect = await getUserStripeConnect(row.owner_user_id)
    connectAccountId = connect?.stripe_connect_account_id ?? null
  }

  let session: Stripe.Checkout.Session
  try {
    session = await stripe.checkout.sessions.retrieve(
      sessionId,
      connectAccountId ? { stripeAccount: connectAccountId } : undefined
    )
  } catch {
    session = await stripe.checkout.sessions.retrieve(sessionId)
  }
  const meta = session.metadata || {}
  connectAccountId = (meta.stripe_connect_account_id || "").trim() || connectAccountId
  if (connectAccountId) {
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId, {
        stripeAccount: connectAccountId,
      })
    } catch {
      /* keep */
    }
  }
  if (!token) token = (meta.pay_token || "").trim()
  const chargeCents = Math.max(
    0,
    Math.round(
      Number(meta.charge_cents) ||
        (typeof session.amount_total === "number" ? session.amount_total : 0) ||
        row?.charge_cents ||
        0
    )
  )
  const expiresAt =
    row?.expires_at ||
    (session.expires_at
      ? new Date(session.expires_at * 1000).toISOString()
      : new Date().toISOString())
  const expired = new Date(expiresAt).getTime() < Date.now() && session.payment_status !== "paid"

  let fulfilledNow = false
  if (session.payment_status === "paid") {
    const piRef = session.payment_intent
    const paymentIntentId = typeof piRef === "string" ? piRef : piRef?.id
    const before = paymentIntentId
      ? await findWalletTransactionByPaymentIntent(paymentIntentId)
      : null
    await fulfillCollectPayLinkFromCheckout(session)
    const after = paymentIntentId
      ? await findWalletTransactionByPaymentIntent(paymentIntentId)
      : null
    fulfilledNow = Boolean(after?.status === "COMPLETED" && before?.status !== "COMPLETED")
  }

  const piRef = session.payment_intent
  const paymentIntentId = typeof piRef === "string" ? piRef : piRef?.id
  const wallet = paymentIntentId
    ? await findWalletTransactionByPaymentIntent(paymentIntentId)
    : null

  let paymentStatus: CollectPayLinkStatus["paymentStatus"] = "unknown"
  if (expired) paymentStatus = "expired"
  else if (session.payment_status === "paid") paymentStatus = "paid"
  else if (session.payment_status === "unpaid") paymentStatus = "unpaid"
  else if (session.payment_status === "no_payment_required") paymentStatus = "no_payment_required"

  return {
    token: token || sessionId.slice(-10),
    url: token ? `${appUrl}/pay/${token}` : `${appUrl}/pay/thanks?session_id=${sessionId}`,
    stripeSessionId: sessionId,
    jobId: row?.job_id ?? ((meta.job_id || "").trim() || null),
    chargeCents,
    customerName: row?.customer_name || (meta.customer_name || "").trim(),
    businessLabel: row?.business_label || (meta.business_label || "").trim(),
    createdAt: row?.created_at || new Date().toISOString(),
    expiresAt,
    paymentStatus,
    walletSettled: wallet?.status === "COMPLETED",
    fulfilledNow,
  }
}

/** Sync every stored link for a job (owner Collect Payment status + wallet repair). */
export async function syncCollectPayLinksForJob(
  ownerUserId: string,
  jobId: string
): Promise<CollectPayLinkStatus[]> {
  const { listCollectPayLinksByJobId } = await import("@/lib/db")
  const rows = await listCollectPayLinksByJobId(ownerUserId, jobId, 20)
  const out: CollectPayLinkStatus[] = []
  for (const row of rows) {
    const status = await syncCollectPayLinkStatus({
      token: row.token,
      stripeSessionId: row.stripe_session_id || null,
    })
    if (status) out.push(status)
  }
  return out
}

export type CancelPayLinkResult =
  | { ok: true; token: string; alreadyPaid: boolean; alreadyExpired: boolean }
  | { ok: false; error: string }

/**
 * Expire an unpaid Checkout pay link so the customer cannot pay the wrong amount.
 * Paid links are left alone.
 */
export async function cancelCollectPayLink(params: {
  actingUserId: string
  token?: string | null
  stripeSessionId?: string | null
}): Promise<CancelPayLinkResult> {
  if (!isStripeConfigured()) return { ok: false, error: "Stripe is not configured" }

  const token = (params.token ?? "").trim()
  const sessionId = (params.stripeSessionId ?? "").trim()
  if (!token && !sessionId) return { ok: false, error: "Missing pay link" }

  const { getCollectPayLinkByTokenAny, getCollectPayLinkBySessionId, markCollectPayLinkExpired, getUserStripeConnect } =
    await import("@/lib/db")

  const row =
    (token ? await getCollectPayLinkByTokenAny(token) : null) ||
    (sessionId ? await getCollectPayLinkBySessionId(sessionId) : null)

  // Fallback: sync first so we can resolve Connect + status from Stripe metadata.
  const live = await syncCollectPayLinkStatus({
    token: token || row?.token,
    stripeSessionId: sessionId || row?.stripe_session_id,
  })
  if (!live && !row) return { ok: false, error: "Pay link not found" }

  const ownerUserId = row?.owner_user_id || null
  if (ownerUserId && ownerUserId !== params.actingUserId) {
    if (live?.jobId) {
      const job = await getJobPaymentContext(live.jobId)
      if (!job || (job.ownerUserId !== params.actingUserId && job.assignedTechId !== params.actingUserId)) {
        return { ok: false, error: "Not allowed" }
      }
    } else if (row?.acting_user_id !== params.actingUserId) {
      return { ok: false, error: "Not allowed" }
    }
  }

  if (live?.paymentStatus === "paid" || live?.walletSettled) {
    return {
      ok: true,
      token: live.token,
      alreadyPaid: true,
      alreadyExpired: false,
    }
  }
  if (live?.paymentStatus === "expired") {
    const t = live.token || row?.token || token
    if (t) await markCollectPayLinkExpired(t).catch(() => false)
    return { ok: true, token: t, alreadyPaid: false, alreadyExpired: true }
  }

  const expireSessionId = live?.stripeSessionId || row?.stripe_session_id || sessionId
  const expireToken = live?.token || row?.token || token
  // Tip not chosen yet — expire the local row only (no Stripe session to cancel).
  if (!expireSessionId) {
    if (expireToken) await markCollectPayLinkExpired(expireToken).catch(() => false)
    return {
      ok: true,
      token: expireToken || token,
      alreadyPaid: false,
      alreadyExpired: false,
    }
  }

  let connectAccountId: string | null = null
  if (ownerUserId) {
    const connect = await getUserStripeConnect(ownerUserId)
    connectAccountId = connect?.stripe_connect_account_id ?? null
  }

  const stripe = getStripeClient()
  try {
    if (connectAccountId) {
      await stripe.checkout.sessions.expire(expireSessionId, {}, { stripeAccount: connectAccountId })
    } else {
      await stripe.checkout.sessions.expire(expireSessionId)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // Already expired / complete — still mark local row so UI cleans up.
    if (!/already|expired|complete|No such/i.test(msg)) {
      console.warn("[pay-link] expire failed:", msg)
      return { ok: false, error: "Could not cancel this pay link. Try Refresh, then Cancel again." }
    }
  }

  if (expireToken) await markCollectPayLinkExpired(expireToken).catch(() => false)
  return {
    ok: true,
    token: expireToken || expireSessionId.slice(-10),
    alreadyPaid: false,
    alreadyExpired: false,
  }
}

/** Cancel every unpaid (Waiting) pay link for a job — e.g. after an in-person card charge. */
export async function cancelOpenCollectPayLinksForJob(params: {
  actingUserId: string
  ownerUserId: string
  jobId: string
}): Promise<{ canceled: number; skippedPaid: number }> {
  const links = await syncCollectPayLinksForJob(params.ownerUserId, params.jobId)
  let canceled = 0
  let skippedPaid = 0
  for (const link of links) {
    if (link.paymentStatus === "paid" || link.walletSettled) {
      skippedPaid += 1
      continue
    }
    if (link.paymentStatus === "expired") continue
    const result = await cancelCollectPayLink({
      actingUserId: params.actingUserId,
      token: link.token,
      stripeSessionId: link.stripeSessionId,
    })
    if (result.ok && !result.alreadyPaid) canceled += 1
    if (result.ok && result.alreadyPaid) skippedPaid += 1
  }
  return { canceled, skippedPaid }
}

/** Resolve a Checkout session from a short pay token (DB, then Stripe search). */
export async function resolvePayLinkSession(token: string): Promise<{
  session: Stripe.Checkout.Session
  businessLabel: string
  chargeCents: number
  customerName: string
  stripeConnectAccountId: string | null
} | null> {
  const key = token.trim()
  if (!key) return null
  const stripe = getStripeClient()

  let sessionId: string | null = null
  let ownerUserId: string | null = null
  if (key.startsWith("cs_")) {
    sessionId = key
  } else {
    const { getCollectPayLinkByToken } = await import("@/lib/db")
    const row = await getCollectPayLinkByToken(key)
    if (row) {
      sessionId = row.stripe_session_id
      ownerUserId = row.owner_user_id
    }
  }

  if (!sessionId) return null

  // Direct-charge sessions live on the connected account.
  let connectAccountId: string | null = null
  if (ownerUserId) {
    const { getUserStripeConnect } = await import("@/lib/db")
    const connect = await getUserStripeConnect(ownerUserId)
    connectAccountId = connect?.stripe_connect_account_id ?? null
  }

  let session: Stripe.Checkout.Session
  try {
    session = await stripe.checkout.sessions.retrieve(
      sessionId,
      connectAccountId ? { stripeAccount: connectAccountId } : undefined
    )
  } catch {
    // Legacy platform sessions (pre-Connect) or unknown account — try platform.
    session = await stripe.checkout.sessions.retrieve(sessionId)
  }

  const meta = session.metadata || {}
  connectAccountId =
    (meta.stripe_connect_account_id || "").trim() || connectAccountId
  if (connectAccountId && !session.client_secret) {
    // Re-fetch on connected account if we learned the id from metadata after platform fetch.
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId, {
        stripeAccount: connectAccountId,
      })
    } catch {
      /* keep prior */
    }
  }

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
    businessLabel: (meta.business_label || "").trim() || "Your service provider",
    chargeCents,
    customerName: (meta.customer_name || "").trim(),
    stripeConnectAccountId: connectAccountId,
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
    const greeting = customerName ? `Hey ${customerName} — ` : ""
    const text = [
      `${greeting}${businessLabel} sent a pay link for ${amount}.`,
      params.url,
    ].join(" ")
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
