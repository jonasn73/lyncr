// GET /api/payments/terminal/location
// Stripe Terminal Location id required by the React Native Tap to Pay SDK.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUser } from "@/lib/db"
import { isStripeConfigured } from "@/lib/stripe-config"
import { getOrCreateTerminalLocationId } from "@/lib/stripe-terminal-location"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(req: NextRequest) {
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
    const locationId = await getOrCreateTerminalLocationId({
      userId,
      displayName: user.business_name || user.name || "Lyncr",
    })
    return NextResponse.json({ data: { locationId } })
  } catch (e) {
    console.error("[payments/terminal/location]", e)
    const message = e instanceof Error ? e.message : "Could not resolve Terminal location"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
