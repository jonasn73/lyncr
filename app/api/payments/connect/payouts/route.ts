// GET  /api/payments/connect/payouts — recent bank transfers (Stripe Connect payouts)
// POST /api/payments/connect/payouts — manual transfer of available balance to bank

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUser } from "@/lib/db"
import { isStripeConfigured } from "@/lib/stripe-config"
import {
  createConnectPayout,
  listConnectPayouts,
} from "@/lib/stripe-connect-payouts"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 })
  }

  const lim = Number(req.nextUrl.searchParams.get("limit") || "20")
  try {
    const payouts = await listConnectPayouts(userId, lim)
    return NextResponse.json({ data: { payouts } })
  } catch (e) {
    console.error("[GET /api/payments/connect/payouts]", e)
    const message = e instanceof Error ? e.message : "Could not load bank transfers"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    amountCents?: number
    /** When true, send the full available balance. */
    fullAvailable?: boolean
  }

  try {
    const payout = await createConnectPayout({
      userId,
      amountCents: body.fullAvailable ? null : body.amountCents,
    })
    return NextResponse.json({ data: { payout } })
  } catch (e) {
    console.error("[POST /api/payments/connect/payouts]", e)
    const message = e instanceof Error ? e.message : "Could not transfer to bank"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
