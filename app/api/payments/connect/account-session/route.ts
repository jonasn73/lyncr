// POST /api/payments/connect/account-session
// Create Stripe Account Session for embedded Get paid onboarding / account management.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUser } from "@/lib/db"
import { isStripeConfigured, getStripePublishableKey } from "@/lib/stripe-config"
import {
  createConnectAccountSession,
  syncConnectAccountFromStripe,
} from "@/lib/stripe-connect"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type Body = {
  /** onboarding | management | both (default both) */
  components?: string
}

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

  const body = (await req.json().catch(() => ({}))) as Body
  const raw = String(body.components ?? "both").trim().toLowerCase()
  const components =
    raw === "onboarding" || raw === "management" || raw === "both" ? raw : "both"

  try {
    const { clientSecret, accountId } = await createConnectAccountSession(userId, components)
    await syncConnectAccountFromStripe(userId, accountId).catch(() => null)
    return NextResponse.json({
      data: {
        clientSecret,
        accountId,
        publishableKey: getStripePublishableKey(),
      },
    })
  } catch (e) {
    console.error("[payments/connect/account-session]", e)
    const message = e instanceof Error ? e.message : "Could not start payout setup"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
