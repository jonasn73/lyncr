// POST /api/billing/stripe/portal — self-serve Stripe Billing Portal session (cancel, update card).
// This is currently the only self-serve off-ramp: without it, canceling means emailing support
// or letting a card fail.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { rejectIfShopNotUsable } from "@/lib/admin-api-guard"
import { getStripeClient, isStripeConfigured } from "@/lib/stripe-config"
import { getAppUrl } from "@/lib/telnyx"
import { getOnboardingProfile } from "@/lib/db"

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  const locked = await rejectIfShopNotUsable(userId)
  if (locked) return locked

  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Billing is not configured on the server." },
      { status: 503 }
    )
  }

  try {
    const profile = await getOnboardingProfile(userId)
    const customerId = profile?.stripe_customer_id?.trim()
    if (!customerId) {
      return NextResponse.json(
        { error: "No billing account found yet — subscribe to a plan first." },
        { status: 400 }
      )
    }

    const stripe = getStripeClient()
    const appUrl = getAppUrl().replace(/\/$/, "")
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/dashboard`,
    })

    return NextResponse.json({ data: { url: session.url } })
  } catch (e) {
    console.error("[billing/stripe/portal POST]", e)
    const msg = e instanceof Error ? e.message : "Could not open billing portal"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
