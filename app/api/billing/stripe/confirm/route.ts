import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  confirmStripeCheckoutSession,
  recoverStripeSubscriptionForUser,
} from "@/lib/stripe-confirm-checkout"
import { isStripeConfigured } from "@/lib/stripe-config"

/**
 * POST /api/billing/stripe/confirm
 * Sync Neon after Stripe Checkout — uses session_id or falls back to email lookup.
 *
 * Important: when there is no session and no recoverable subscription, return **200**
 * with `{ synced: false }` — NOT HTTP 404. A 404 here is not “route missing”; browsers
 * still log it as a failed resource and it looks like Charge/card is broken.
 */
export async function POST(req: NextRequest) {
  // Who is logged in (from the HTTP-only session cookie).
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  // Not logged in → client must sign in again.
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  // Stripe secret key missing in this environment.
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 })
  }

  try {
    // Optional body: { session_id } from Checkout redirect query string.
    const body = (await req.json().catch(() => ({}))) as { session_id?: string }
    const sessionId = body.session_id?.trim()

    if (sessionId) {
      // Explicit Checkout return — must sync that session or surface a real error.
      await confirmStripeCheckoutSession(userId, sessionId)
      return NextResponse.json({ data: { synced: true } })
    }

    // Dashboard auto-recover (no session_id): try match by email / customer.
    const recovered = await recoverStripeSubscriptionForUser(userId)
    if (!recovered) {
      // Soft miss — unpaid / already-synced shops hit this often. Do not use 404.
      return NextResponse.json({
        data: { synced: false, reason: "no_subscription" as const },
      })
    }

    return NextResponse.json({ data: { synced: true } })
  } catch (e) {
    console.error("[billing/stripe/confirm POST]", e)
    const msg = e instanceof Error ? e.message : "Could not sync subscription"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
