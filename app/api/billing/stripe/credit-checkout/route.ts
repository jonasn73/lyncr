import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { rejectIfShopNotUsable } from "@/lib/admin-api-guard"
import { createLyncrCreditPackCheckout } from "@/lib/stripe-checkout"
import { CREDIT_PACK_CENTS_USD } from "@/lib/billing-pricing"
import { isStripeConfigured } from "@/lib/stripe-config"

/** Starts Stripe Checkout for a prepaid carrier credit pack. */
export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  const locked = await rejectIfShopNotUsable(userId)
  if (locked) return locked

  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 })
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { amount_cents?: number }
    const amountCents = Number(body.amount_cents)
    if (!CREDIT_PACK_CENTS_USD.includes(amountCents as (typeof CREDIT_PACK_CENTS_USD)[number])) {
      return NextResponse.json({ error: "Invalid credit pack amount." }, { status: 400 })
    }

    const { url, sessionId } = await createLyncrCreditPackCheckout(userId, amountCents)
    return NextResponse.json({ data: { url, session_id: sessionId } })
  } catch (e) {
    console.error("[billing/stripe/credit-checkout POST]", e)
    const msg = e instanceof Error ? e.message : "Could not start credit checkout"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
