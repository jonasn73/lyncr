import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { createLyncrCoreSubscriptionCheckout } from "@/lib/stripe-checkout"
import { isStripeConfigured } from "@/lib/stripe-config"

/** Creates Stripe Checkout for the $29/mo core plan; metadata includes user_id + reserved_number. */
export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Stripe is not configured. Set STRIPE_SECRET_KEY in Vercel." },
      { status: 503 }
    )
  }

  try {
    await req.json().catch(() => ({}))
    const { url, sessionId } = await createLyncrCoreSubscriptionCheckout(userId)
    return NextResponse.json({ data: { url, session_id: sessionId } })
  } catch (e) {
    console.error("[billing/stripe/checkout POST]", e)
    const msg = e instanceof Error ? e.message : "Could not start checkout"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
