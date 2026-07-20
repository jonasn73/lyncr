// POST /api/payments/create-intent
// Create a Stripe PaymentIntent for a job charge + PENDING tech wallet transaction.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUser } from "@/lib/db"
import { isStripeConfigured } from "@/lib/stripe-config"
import {
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

  if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 })
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

  const job = await getJobPaymentContext(jobId)
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 })

  // Assigned tech or business owner may charge. Owner can collect on the go even before assign.
  const isTech = job.assignedTechId === userId
  const isOwner = job.ownerUserId === userId
  if (!isTech && !isOwner) {
    return NextResponse.json({ error: "Not allowed to charge this job" }, { status: 403 })
  }
  // On-the-go owner collect: credit the owner's wallet when no tech is assigned yet.
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
      },
    })
  } catch (e) {
    console.error("[payments/create-intent]", e)
    const message = e instanceof Error ? e.message : "Could not create payment intent"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
