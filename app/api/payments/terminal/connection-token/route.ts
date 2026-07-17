// POST /api/payments/terminal/connection-token
// Stripe Terminal short-lived connection token for Tap to Pay / reader SDK.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUser } from "@/lib/db"
import { getStripeClient, isStripeConfigured } from "@/lib/stripe-config"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user || (user.account_role !== "field_tech" && user.account_role !== "owner")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 })
  }

  try {
    const stripe = getStripeClient()
    const token = await stripe.terminal.connectionTokens.create()
    return NextResponse.json({ data: { secret: token.secret } })
  } catch (e) {
    console.error("[payments/terminal/connection-token]", e)
    const message = e instanceof Error ? e.message : "Could not create connection token"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
