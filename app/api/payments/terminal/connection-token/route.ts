// POST /api/payments/terminal/connection-token
// Stripe Terminal short-lived connection token for Tap to Pay / reader SDK.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUser } from "@/lib/db"
import { getStripeClient, isStripeConfigured } from "@/lib/stripe-config"
import { getOrCreateTerminalLocationId } from "@/lib/stripe-terminal-location"

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
    // Direct charges / Tap to Pay on the connected account need a Connect connection token.
    let stripeAccount: string | undefined
    if (user.account_role === "owner") {
      const { getConnectReadyState } = await import("@/lib/stripe-connect")
      const state = await getConnectReadyState(userId)
      if (state.ready) stripeAccount = state.accountId
    } else if (user.account_role === "field_tech") {
      const { neon } = await import("@neondatabase/serverless")
      const { resolveNeonDatabaseUrl } = await import("@/lib/neon-database-url")
      const sql = neon(resolveNeonDatabaseUrl())
      try {
        const rows = await sql`
          SELECT ft.owner_user_id
          FROM field_technicians ft
          WHERE ft.portal_user_id = ${userId}
          LIMIT 1
        `
        const ownerId = rows[0]
          ? String((rows[0] as { owner_user_id: string }).owner_user_id)
          : null
        if (ownerId) {
          const { getConnectReadyState } = await import("@/lib/stripe-connect")
          const state = await getConnectReadyState(ownerId)
          if (state.ready) stripeAccount = state.accountId
        }
      } catch {
        /* fall through — platform token */
      }
    }

    const token = await stripe.terminal.connectionTokens.create(
      {},
      stripeAccount ? { stripeAccount } : undefined
    )
    const locationId = await getOrCreateTerminalLocationId({
      userId,
      displayName: user.business_name || user.name || "Lyncr",
    })
    return NextResponse.json({
      data: {
        secret: token.secret,
        locationId,
        stripeConnectAccountId: stripeAccount || null,
      },
    })
  } catch (e) {
    console.error("[payments/terminal/connection-token]", e)
    const message = e instanceof Error ? e.message : "Could not create connection token"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
