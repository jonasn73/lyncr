import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { createOrUpgradeLyncrSubscription } from "@/lib/stripe-checkout"
import { isStripeConfigured } from "@/lib/stripe-config"
import { normalizeCheckoutSubscriptionTier } from "@/lib/subscription-checkout"

/** POST /api/billing/stripe/checkout — body: { tier?: "starter" | "professional" | "business" } */
export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  if (!isStripeConfigured()) {
    return NextResponse.json(
      {
        error:
          "Stripe secret key not found on the server. In Vercel → Settings → Environment Variables, add STRIPE_SECRET_KEY (exact name) for Production, then redeploy.",
      },
      { status: 503 }
    )
  }

  try {
    const body = await req.json().catch(() => ({}))
    const tier = normalizeCheckoutSubscriptionTier(
      body && typeof body === "object" ? String((body as Record<string, unknown>).tier ?? "starter") : "starter"
    )
    const result = await createOrUpgradeLyncrSubscription(userId, tier)
    if (result.mode === "upgraded") {
      return NextResponse.json({
        data: {
          upgraded: true,
          tier: result.tier,
          tier_label: result.tier_label,
        },
      })
    }
    return NextResponse.json({ data: { url: result.url, session_id: result.sessionId, tier } })
  } catch (e) {
    console.error("[billing/stripe/checkout POST]", e)
    const msg = e instanceof Error ? e.message : "Could not start checkout"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
