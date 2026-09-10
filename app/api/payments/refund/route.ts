// POST /api/payments/refund — owner-issued full or partial refund of a collected charge.
//
// Only calls Stripe's refund API. The charge.refunded webhook (lib/wallet-reversals.ts) already
// reverses the wallet ledger + commission and texts the owner, whether the refund came from here
// or from Stripe's own dashboard — this route must not duplicate that.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUser } from "@/lib/db"
import { isStripeConfigured } from "@/lib/stripe-config"
import { refundCollectedCharge } from "@/lib/job-payments"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type Body = {
  stripePaymentIntentId?: string
  /** USD cents. Omit for a full refund of whatever hasn't already been refunded. */
  amountCents?: number
}

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 })
  }

  const user = await getUser(userId)
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  // Real, irreversible money movement — owner only, not a capability an owner can delegate.
  if (user.account_role !== "owner") {
    return NextResponse.json({ error: "Only the business owner can issue refunds" }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as Body
  const paymentIntentId = String(body.stripePaymentIntentId ?? "").trim()
  if (!paymentIntentId) {
    return NextResponse.json({ error: "stripePaymentIntentId is required" }, { status: 400 })
  }
  const amountCents =
    body.amountCents != null && Number.isFinite(Number(body.amountCents))
      ? Math.round(Number(body.amountCents))
      : undefined

  try {
    const result = await refundCollectedCharge({
      ownerUserId: userId,
      paymentIntentId,
      amountCents,
    })
    return NextResponse.json({ data: result })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not issue refund"
    const status = message === "Payment not found" ? 404 : 400
    console.error("[POST /api/payments/refund]", e)
    return NextResponse.json({ error: message }, { status })
  }
}
