import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { rejectIfShopNotUsable } from "@/lib/admin-api-guard"
import { createLyncrSubscriptionCheckout } from "@/lib/stripe-checkout"
import { isStripeConfigured } from "@/lib/stripe-config"
import { normalizeCheckoutSubscriptionTier } from "@/lib/subscription-checkout"

/** Starts Stripe Checkout subscription — webhook completes Neon + Telnyx provision. */
export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  const locked = await rejectIfShopNotUsable(userId)
  if (locked) return locked

  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Stripe is not configured. Set STRIPE_SECRET_KEY in Vercel." },
      { status: 503 }
    )
  }

  try {
    const body = await req.json().catch(() => ({}))
    const tier = normalizeCheckoutSubscriptionTier(
      body && typeof body === "object" ? String((body as Record<string, unknown>).tier ?? "starter") : "starter"
    )
    void body &&
      typeof body === "object" &&
      (body as Record<string, unknown>).save_billing_method === true
    const { url, sessionId } = await createLyncrSubscriptionCheckout(userId, tier)
    return NextResponse.json({
      data: { checkout_url: url, session_id: sessionId, tier },
      message: "Redirecting to secure Stripe checkout…",
    })
  } catch (e) {
    console.error("[onboarding/profile/activate POST]", e)
    const msg = e instanceof Error ? e.message : "Activation failed"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
