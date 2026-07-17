// POST /api/payments/confirm
// Settle a job PaymentIntent after client-side confirmation OR Stripe webhook delivery.
// On success: wallet tx → COMPLETED, tech balance credited, job → completed.

import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUser } from "@/lib/db"
import { confirmJobPaymentIntent, getJobPaymentContext } from "@/lib/job-payments"
import { getStripeClient, getStripeWebhookSecret, isStripeConfigured } from "@/lib/stripe-config"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type Body = {
  paymentIntentId?: string
  payment_intent_id?: string
}

async function settleAndRespond(paymentIntentId: string) {
  const result = await confirmJobPaymentIntent(paymentIntentId)
  return NextResponse.json({
    data: {
      paymentIntentId: result.paymentIntentId,
      status: result.status,
      jobId: result.jobId,
      transaction: result.transaction
        ? {
            id: result.transaction.id,
            amount: result.transaction.amount,
            status: result.transaction.status,
            jobId: result.transaction.jobId,
          }
        : null,
    },
  })
}

export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Stripe is not configured. Set STRIPE_SECRET_KEY in Vercel / .env.local." },
      { status: 503 }
    )
  }

  const signature = req.headers.get("stripe-signature")

  // ── Webhook path (Stripe → this route) ───────────────────────────────────
  if (signature) {
    const rawBody = await req.text()
    let event: Stripe.Event
    try {
      const stripe = getStripeClient()
      event = stripe.webhooks.constructEvent(rawBody, signature, getStripeWebhookSecret())
    } catch (e) {
      console.error("[payments/confirm] webhook signature failed", e)
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
    }

    try {
      if (
        event.type === "payment_intent.succeeded" ||
        event.type === "payment_intent.payment_failed" ||
        event.type === "payment_intent.canceled"
      ) {
        const intent = event.data.object as Stripe.PaymentIntent
        if (intent.metadata?.lyncr_kind === "job_payment") {
          await confirmJobPaymentIntent(intent.id)
        }
      }
      return NextResponse.json({ received: true })
    } catch (e) {
      console.error("[payments/confirm] webhook handler failed", event.type, e)
      return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 })
    }
  }

  // ── Client confirmation path (after stripe.confirmPayment) ───────────────
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Body
  const paymentIntentId = String(body.paymentIntentId || body.payment_intent_id || "").trim()
  if (!paymentIntentId) {
    return NextResponse.json({ error: "paymentIntentId is required" }, { status: 400 })
  }

  try {
    // Authorize: acting user must be tech/owner on the related job when metadata is present.
    const stripe = getStripeClient()
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId)
    const jobId = intent.metadata?.job_id?.trim()
    if (jobId) {
      const job = await getJobPaymentContext(jobId)
      if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 })
      const allowed =
        job.assignedTechId === userId ||
        (job.ownerUserId === userId && user.account_role === "owner")
      if (!allowed) {
        return NextResponse.json({ error: "Not allowed to confirm this payment" }, { status: 403 })
      }
    }

    return await settleAndRespond(paymentIntentId)
  } catch (e) {
    console.error("[payments/confirm]", e)
    const message = e instanceof Error ? e.message : "Could not confirm payment"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
