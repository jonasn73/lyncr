// POST /api/payments/send-receipt — email or SMS a receipt after Collect Payment.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUser } from "@/lib/db"
import { isStripeConfigured } from "@/lib/stripe-config"
import { sendPaymentReceipt } from "@/lib/payment-receipt-send"

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
    channel?: string
    customerName?: string
    email?: string
    phone?: string
  }

  const paymentIntentId = String(body.paymentIntentId ?? "").trim()
  const channel = String(body.channel ?? "").trim().toLowerCase()
  if (!paymentIntentId) {
    return NextResponse.json({ error: "paymentIntentId is required" }, { status: 400 })
  }
  if (channel !== "email" && channel !== "sms") {
    return NextResponse.json({ error: "channel must be email or sms" }, { status: 400 })
  }

  try {
    const result = await sendPaymentReceipt({
      userId,
      paymentIntentId,
      channel,
      customerName: body.customerName,
      email: body.email,
      phone: body.phone,
    })
    if (!result.sent) {
      return NextResponse.json({ error: result.error || "Could not send receipt" }, { status: 400 })
    }
    return NextResponse.json({ data: { sent: true, channel } })
  } catch (e) {
    console.error("[payments/send-receipt]", e)
    const message = e instanceof Error ? e.message : "Could not send receipt"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
