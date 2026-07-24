// POST /api/payments/connect/account-link
// Hosted Stripe onboarding URL — fallback when embedded Get paid sticks on mobile.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUser } from "@/lib/db"
import { isStripeConfigured } from "@/lib/stripe-config"
import { createConnectAccountOnboardingLink } from "@/lib/stripe-connect"
import { getAppUrl } from "@/lib/telnyx"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  if (user.account_role === "field_tech") {
    return NextResponse.json(
      { error: "Ask the business owner to finish Get paid in Settings." },
      { status: 403 }
    )
  }

  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 })
  }

  try {
    const base = getAppUrl().replace(/\/$/, "")
    const returnUrl = `${base}/dashboard?tab=get-paid&connect=return`
    const refreshUrl = `${base}/dashboard?tab=get-paid&connect=refresh`
    const { url, accountId } = await createConnectAccountOnboardingLink(userId, {
      returnUrl,
      refreshUrl,
    })
    return NextResponse.json({ data: { url, accountId } })
  } catch (e) {
    console.error("[payments/connect/account-link]", e)
    const message = e instanceof Error ? e.message : "Could not open Stripe setup"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
