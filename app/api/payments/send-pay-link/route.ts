// POST /api/payments/send-pay-link
// Create a Stripe Checkout pay link and text or email it to the customer.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUser } from "@/lib/db"
import { isStripeConfigured } from "@/lib/stripe-config"
import {
  createCollectPayLinkCheckout,
  sendCollectPayLink,
} from "@/lib/job-pay-link"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type Body = {
  channel?: string
  jobId?: string
  adhoc?: boolean
  amount?: number
  taxEnabled?: boolean
  taxRatePercent?: number
  note?: string
  customerName?: string
  email?: string
  phone?: string
  lineItems?: { label?: string; amountCents?: number }[]
}

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Stripe is not configured. Set STRIPE_SECRET_KEY in Vercel / .env.local." },
      { status: 503 }
    )
  }

  const body = (await req.json().catch(() => ({}))) as Body
  const channel = String(body.channel ?? "").trim().toLowerCase()
  if (channel !== "email" && channel !== "sms") {
    return NextResponse.json({ error: "channel must be email or sms" }, { status: 400 })
  }

  const amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "amount must be a positive USD amount" }, { status: 400 })
  }

  // `amount` is the pre-tax subtotal in dollars (same as Collect UI).
  const subtotalCents = Math.round(amount * 100)
  if (subtotalCents < 50) {
    return NextResponse.json({ error: "amount must be at least $0.50" }, { status: 400 })
  }

  const taxEnabled = Boolean(body.taxEnabled)
  const taxRatePercent = Number(body.taxRatePercent)
  const rate =
    taxEnabled && Number.isFinite(taxRatePercent) && taxRatePercent > 0
      ? Math.min(30, taxRatePercent) / 100
      : 0
  const taxCents = rate > 0 ? Math.round(subtotalCents * rate) : 0
  const chargeCents = subtotalCents + taxCents

  const jobId = String(body.jobId ?? "").trim()
  const wantAdhoc = Boolean(body.adhoc) || !jobId

  if (wantAdhoc && user.account_role === "field_tech") {
    return NextResponse.json(
      { error: "Walk-up pay links are for the business account — use a job instead." },
      { status: 403 }
    )
  }

  const lineSummary =
    Array.isArray(body.lineItems) && body.lineItems.length > 0
      ? body.lineItems
          .map((li) => String(li.label || "").trim())
          .filter(Boolean)
          .join(", ")
          .slice(0, 80)
      : body.note?.trim() || undefined

  try {
    const checkout = await createCollectPayLinkCheckout({
      actingUserId: userId,
      jobId: wantAdhoc ? null : jobId,
      chargeCents,
      subtotalCents,
      taxCents,
      note: body.note,
      customerName: body.customerName,
      customerEmail: channel === "email" ? body.email : undefined,
      lineSummary,
    })

    const businessLabel = user.business_name?.trim() || user.name?.trim() || "Lyncr"
    const sent = await sendCollectPayLink({
      actingUserId: userId,
      channel,
      url: checkout.url,
      chargeCents: checkout.chargeCents,
      customerName: body.customerName,
      email: body.email,
      phone: body.phone,
      businessLabel,
    })

    if (!sent.sent) {
      // Link was created — still return URL so the owner can copy/paste if SMS/email failed.
      return NextResponse.json(
        {
          error: sent.error || "Could not send message",
          data: {
            url: checkout.url,
            sessionId: checkout.sessionId,
            chargeCents: checkout.chargeCents,
            sent: false,
          },
        },
        { status: 400 }
      )
    }

    return NextResponse.json({
      data: {
        url: checkout.url,
        sessionId: checkout.sessionId,
        chargeCents: checkout.chargeCents,
        sent: true,
        channel,
      },
    })
  } catch (e) {
    console.error("[payments/send-pay-link]", e)
    const message = e instanceof Error ? e.message : "Could not send pay link"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
