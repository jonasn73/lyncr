// GET /api/pay/[token] — load embedded Checkout client_secret for a branded pay page.

import { NextRequest, NextResponse } from "next/server"
import { isStripeConfigured, getStripePublishableKey } from "@/lib/stripe-config"
import { resolvePayLinkSession } from "@/lib/job-pay-link"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Payments are not configured." }, { status: 503 })
  }

  const { token } = await ctx.params
  const key = String(token || "").trim()
  if (!key || key.length < 6) {
    return NextResponse.json({ error: "Invalid payment link." }, { status: 400 })
  }

  try {
    const resolved = await resolvePayLinkSession(key)
    if (!resolved) {
      return NextResponse.json(
        { error: "This payment link is invalid or has expired." },
        { status: 404 }
      )
    }

    const { session, businessLabel, chargeCents, customerName } = resolved

    if (session.status === "complete" || session.payment_status === "paid") {
      return NextResponse.json({
        data: {
          status: "paid",
          business_label: businessLabel,
          charge_cents: chargeCents,
          customer_name: customerName,
        },
      })
    }

    if (session.status === "expired") {
      return NextResponse.json(
        { error: "This payment link has expired. Ask the business for a new one." },
        { status: 410 }
      )
    }

    // Embedded sessions expose client_secret; legacy hosted sessions may not.
    let clientSecret = session.client_secret
    if (!clientSecret && session.url) {
      // Old hosted Checkout link — tell the client to redirect once.
      return NextResponse.json({
        data: {
          status: "redirect",
          redirect_url: session.url,
          business_label: businessLabel,
          charge_cents: chargeCents,
          customer_name: customerName,
        },
      })
    }

    if (!clientSecret) {
      return NextResponse.json(
        { error: "This payment link cannot be opened. Ask the business for a new one." },
        { status: 409 }
      )
    }

    const publishableKey = getStripePublishableKey()
    if (!publishableKey) {
      return NextResponse.json(
        { error: "Payments are not configured (publishable key)." },
        { status: 503 }
      )
    }

    return NextResponse.json({
      data: {
        status: "open",
        client_secret: clientSecret,
        publishable_key: publishableKey,
        business_label: businessLabel,
        charge_cents: chargeCents,
        customer_name: customerName,
        session_id: session.id,
      },
    })
  } catch (e) {
    console.error("[GET /api/pay/token]", e)
    return NextResponse.json({ error: "Could not load payment link." }, { status: 500 })
  }
}
