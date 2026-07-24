// POST /api/payments/create-intent
// Create a Stripe PaymentIntent for a job charge or walk-up (no job) collect.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUser } from "@/lib/db"
import { isStripeConfigured } from "@/lib/stripe-config"
import {
  createAdhocPaymentIntent,
  createJobPaymentIntent,
  getJobPaymentContext,
  normalizeJobPaymentMethod,
  resolveVerifiedChargeCents,
} from "@/lib/job-payments"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type Body = {
  jobId?: string
  amount?: number
  paymentMethodType?: string
  /** When true / line items present, allow on-site invoice total instead of booked quote. */
  invoiceOverride?: boolean
  lineItems?: { label?: string; amountCents?: number }[]
  /** Walk-up / no-job charge note. */
  note?: string
  /** Explicit ad-hoc flag (also implied when jobId is missing). */
  adhoc?: boolean
  customerName?: string
  customerPhone?: string
  /** When true, add sales tax on top of `amount` (subtotal). */
  taxEnabled?: boolean
  /** Percent e.g. 6 for 6%. Used only when taxEnabled. */
  taxRatePercent?: number
}

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Stripe is not configured. Set STRIPE_SECRET_KEY in Vercel / .env.local." },
      { status: 503 }
    )
  }

  const user = await getUser(userId)
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Body
  const jobId = String(body.jobId ?? "").trim()
  const amount = Number(body.amount)
  const paymentMethodType = String(body.paymentMethodType ?? "").trim()
  const wantAdhoc = Boolean(body.adhoc) || !jobId

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "amount must be a positive USD amount" }, { status: 400 })
  }

  const walletMethod = normalizeJobPaymentMethod(paymentMethodType)
  if (!walletMethod) {
    return NextResponse.json(
      {
        error:
          "paymentMethodType must be TAP_TO_PAY or MANUAL_CARD (use cash via the invoice flow, not Stripe)",
      },
      { status: 400 }
    )
  }

  // —— Walk-up / no-job collect ——
  if (wantAdhoc && !jobId) {
    if (user.account_role === "field_tech") {
      return NextResponse.json(
        { error: "Walk-up payments are for the business account — use a job charge instead." },
        { status: 403 }
      )
    }
    // Client sends USD dollars for the service/subtotal (e.g. 85 or 85.50).
    const subtotalCents = Math.round(amount * 100)
    if (subtotalCents < 50) {
      return NextResponse.json({ error: "amount must be at least $0.50" }, { status: 400 })
    }

    const taxEnabled = Boolean(body.taxEnabled)
    const taxRatePercent = Number(body.taxRatePercent)
    const rate =
      taxEnabled && Number.isFinite(taxRatePercent) && taxRatePercent > 0
        ? Math.min(30, taxRatePercent) / 100
        : 0
    const taxCents = rate > 0 ? Math.round(subtotalCents * rate) : 0
    const chargeCents = subtotalCents + taxCents

    try {
      const result = await createAdhocPaymentIntent({
        ownerUserId: userId,
        chargeCents,
        walletMethod,
        note: body.note,
        customerName: body.customerName,
        customerPhone: body.customerPhone,
        subtotalCents,
        taxCents,
      })
      return NextResponse.json({
        data: {
          client_secret: result.clientSecret,
          clientSecret: result.clientSecret,
          paymentIntentId: result.paymentIntentId,
          chargeCents: result.chargeCents,
          subtotalCents,
          taxCents,
          commissionCents: result.commissionCents,
          transactionId: result.transaction?.id ?? null,
          publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() || null,
          stripeConnectAccountId: result.stripeConnectAccountId,
          adhoc: true,
        },
      })
    } catch (e) {
      console.error("[payments/create-intent adhoc]", e)
      const message = e instanceof Error ? e.message : "Could not create payment intent"
      const status = message.includes("Get paid") || message.includes("payout") ? 403 : 500
      return NextResponse.json({ error: message }, { status })
    }
  }

  if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 })

  const job = await getJobPaymentContext(jobId)
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 })

  const isTech = job.assignedTechId === userId
  const isOwner = job.ownerUserId === userId
  if (!isTech && !isOwner) {
    return NextResponse.json({ error: "Not allowed to charge this job" }, { status: 403 })
  }
  const jobForCharge =
    !job.assignedTechId && isOwner ? { ...job, assignedTechId: userId } : job
  if (!jobForCharge.assignedTechId) {
    return NextResponse.json({ error: "Assign a technician before collecting payment" }, { status: 400 })
  }

  const hasLineItems = Array.isArray(body.lineItems) && body.lineItems.length > 0
  const verified = resolveVerifiedChargeCents(job, amount, {
    allowInvoiceOverride: Boolean(body.invoiceOverride) || hasLineItems,
  })
  if (!verified.ok) {
    return NextResponse.json({ error: verified.error }, { status: 400 })
  }

  try {
    const result = await createJobPaymentIntent({
      job: jobForCharge,
      chargeCents: verified.chargeCents,
      walletMethod,
      actingUserId: userId,
    })

    return NextResponse.json({
      data: {
        client_secret: result.clientSecret,
        clientSecret: result.clientSecret,
        paymentIntentId: result.paymentIntentId,
        chargeCents: result.chargeCents,
        commissionCents: result.commissionCents,
        transactionId: result.transaction?.id ?? null,
        publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() || null,
        stripeConnectAccountId: result.stripeConnectAccountId,
      },
    })
  } catch (e) {
    console.error("[payments/create-intent]", e)
    const message = e instanceof Error ? e.message : "Could not create payment intent"
    const status = message.includes("Get paid") || message.includes("payout") ? 403 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
