// POST /api/payments/complete-slip — save tip + customer signature after Collect Payment.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUser } from "@/lib/db"
import { isStripeConfigured } from "@/lib/stripe-config"
import { upsertPaymentSlip } from "@/lib/payment-slips"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    paymentIntentId?: string
    tipCents?: number
    signaturePng?: string | null
    tipPaymentIntentId?: string | null
  }

  const paymentIntentId = String(body.paymentIntentId ?? "").trim()
  if (!paymentIntentId) {
    return NextResponse.json({ error: "paymentIntentId is required" }, { status: 400 })
  }

  const tipCents = Math.max(0, Math.round(Number(body.tipCents) || 0))

  try {
    const slip = await upsertPaymentSlip({
      userId,
      paymentIntentId,
      tipCents,
      signaturePng: body.signaturePng,
      tipPaymentIntentId: body.tipPaymentIntentId,
    })
    return NextResponse.json({ data: { slip } })
  } catch (e) {
    console.error("[payments/complete-slip]", e)
    const message = e instanceof Error ? e.message : "Could not save tip / signature"
    const status = /migration 112/i.test(message) ? 503 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
