// POST /api/pay/confirm-session
// Public backup after /pay/thanks — if Stripe webhooks lagged, credit the wallet from session_id.

import { NextRequest, NextResponse } from "next/server"
import { isStripeConfigured } from "@/lib/stripe-config"
import { syncCollectPayLinkStatus } from "@/lib/job-pay-link"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type Body = { sessionId?: string }

export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 })
  }

  const body = (await req.json().catch(() => ({}))) as Body
  const sessionId = String(body.sessionId ?? "").trim()
  if (!sessionId.startsWith("cs_")) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 })
  }

  try {
    const link = await syncCollectPayLinkStatus({ stripeSessionId: sessionId })
    if (!link) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }
    return NextResponse.json({
      data: {
        paymentStatus: link.paymentStatus,
        walletSettled: link.walletSettled,
        chargeCents: link.chargeCents,
      },
    })
  } catch (e) {
    console.error("[pay/confirm-session]", e)
    return NextResponse.json({ error: "Could not confirm payment" }, { status: 500 })
  }
}
