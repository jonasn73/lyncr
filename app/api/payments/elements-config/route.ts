// GET /api/payments/elements-config
// Publishable key + Connect account for deferred Payment Element (card key-in before tip).
// Optional ?jobId= — returns the job owner's Connect account (for field tech collect).

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUser } from "@/lib/db"
import { getStripePublishableKey, isStripeConfigured } from "@/lib/stripe-config"
import { getJobPaymentContext } from "@/lib/job-payments"
import { getConnectReadyState, CONNECT_NOT_READY_MESSAGE } from "@/lib/stripe-connect"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Stripe is not configured. Set STRIPE_SECRET_KEY in Vercel / .env.local." },
      { status: 503 }
    )
  }

  const publishableKey = getStripePublishableKey()
  if (!publishableKey) {
    return NextResponse.json(
      { error: "Missing NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY." },
      { status: 503 }
    )
  }

  const jobId = (req.nextUrl.searchParams.get("jobId") || "").trim()
  let ownerUserId = userId

  if (jobId) {
    const job = await getJobPaymentContext(jobId)
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 })
    const isTech = job.assignedTechId === userId
    const isOwner = job.ownerUserId === userId
    if (!isTech && !isOwner) {
      return NextResponse.json({ error: "Not allowed to charge this job" }, { status: 403 })
    }
    ownerUserId = job.ownerUserId
  } else if (user.account_role === "field_tech") {
    return NextResponse.json(
      { error: "Walk-up card entry is for the business account — open a job charge instead." },
      { status: 403 }
    )
  }

  try {
    const state = await getConnectReadyState(ownerUserId)
    if (!state.ready || !state.accountId) {
      return NextResponse.json(
        { error: !state.ready ? state.reason : CONNECT_NOT_READY_MESSAGE },
        { status: 403 }
      )
    }
    return NextResponse.json({
      data: {
        publishableKey,
        stripeConnectAccountId: state.accountId,
      },
    })
  } catch (e) {
    console.error("[payments/elements-config]", e)
    const message = e instanceof Error ? e.message : "Could not load card form config"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
