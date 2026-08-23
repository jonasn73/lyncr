// POST /api/payments/confirm
// Settle a job PaymentIntent after client-side confirmation (stripe.confirmPayment on the
// client). Server-to-server webhook delivery goes to /api/webhooks/stripe exclusively — this
// route used to also accept a signed webhook body, but running two live receivers for the
// same payment_intent.* events raced against each other and let pay-link fulfillment
// (handled only in /api/webhooks/stripe) silently never run when Stripe hit this URL instead.
// On success: wallet tx → COMPLETED, tech balance credited, job → completed.

import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUser } from "@/lib/db"
import { confirmJobPaymentIntent, getJobPaymentContext } from "@/lib/job-payments"
import { getStripeClient, isStripeConfigured } from "@/lib/stripe-config"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type Body = {
  paymentIntentId?: string
  payment_intent_id?: string
  stripeConnectAccountId?: string
}

async function settleAndRespond(
  paymentIntentId: string,
  stripeConnectAccountId?: string | null,
  intent?: Stripe.PaymentIntent | null
) {
  const result = await confirmJobPaymentIntent(paymentIntentId, {
    stripeConnectAccountId: stripeConnectAccountId || null,
    intent: intent || null,
  })
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

  // ── Client confirmation path (after stripe.confirmPayment) ───────────────
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Body
  const paymentIntentId = String(body.paymentIntentId || body.payment_intent_id || "").trim()
  const stripeConnectAccountId = String(body.stripeConnectAccountId || "").trim() || null
  if (!paymentIntentId) {
    return NextResponse.json({ error: "paymentIntentId is required" }, { status: 400 })
  }

  try {
    // Authorize: acting user must be tech/owner on the related job when metadata is present.
    const stripe = getStripeClient()
    const intent = await stripe.paymentIntents.retrieve(
      paymentIntentId,
      stripeConnectAccountId ? { stripeAccount: stripeConnectAccountId } : undefined
    )
    const jobId = intent.metadata?.job_id?.trim()
    const kind = intent.metadata?.lyncr_kind?.trim()
    if (jobId) {
      const job = await getJobPaymentContext(jobId)
      if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 })
      const allowed =
        job.assignedTechId === userId ||
        (job.ownerUserId === userId && user.account_role === "owner")
      if (!allowed) {
        return NextResponse.json({ error: "Not allowed to confirm this payment" }, { status: 403 })
      }
    } else if (kind === "adhoc_payment") {
      // Require an owner match — missing metadata must not let any logged-in user settle.
      const ownerId = intent.metadata?.owner_user_id?.trim()
      if (!ownerId || ownerId !== userId) {
        return NextResponse.json({ error: "Not allowed to confirm this payment" }, { status: 403 })
      }
    } else {
      // Unknown / non-Lyncr PaymentIntents are not confirmable from the client path.
      return NextResponse.json({ error: "Not allowed to confirm this payment" }, { status: 403 })
    }

    return await settleAndRespond(paymentIntentId, stripeConnectAccountId, intent)
  } catch (e) {
    console.error("[payments/confirm]", e)
    const message = e instanceof Error ? e.message : "Could not confirm payment"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
