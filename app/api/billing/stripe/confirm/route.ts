import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  confirmStripeCheckoutSession,
  recoverStripeSubscriptionForUser,
} from "@/lib/stripe-confirm-checkout"
import { isStripeConfigured } from "@/lib/stripe-config"

/** Sync Neon after Stripe Checkout — uses session_id or falls back to email lookup. */
export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 })
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { session_id?: string }
    const sessionId = body.session_id?.trim()

    if (sessionId) {
      await confirmStripeCheckoutSession(userId, sessionId)
    } else {
      const recovered = await recoverStripeSubscriptionForUser(userId)
      if (!recovered) {
        return NextResponse.json(
          { error: "No active Stripe subscription found for your account yet." },
          { status: 404 }
        )
      }
    }

    return NextResponse.json({ data: { synced: true } })
  } catch (e) {
    console.error("[billing/stripe/confirm POST]", e)
    const msg = e instanceof Error ? e.message : "Could not sync subscription"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
