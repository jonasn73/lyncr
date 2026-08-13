// GET /api/pay/[token] — tip step payload or embedded Checkout client_secret.
// POST /api/pay/[token] — customer confirms tip → create Checkout for base+tip.

import { NextRequest, NextResponse } from "next/server"
import { isStripeConfigured, getStripePublishableKey } from "@/lib/stripe-config"
import {
  finalizeCollectPayLinkWithTip,
  resolvePayLinkSession,
} from "@/lib/job-pay-link"
import { ensureStripeWalletPaymentMethodDomains } from "@/lib/stripe-payment-method-domains"
import { getCollectPayLinkByToken } from "@/lib/db"

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
    const row = await getCollectPayLinkByToken(key)

    // New flow: no Checkout yet → customer picks tip first.
    if (row && !row.stripe_session_id) {
      const baseCents = Math.max(
        0,
        Math.round((row.subtotal_cents || 0) + (row.tax_cents || 0) || row.charge_cents || 0)
      )
      if (baseCents < 50) {
        return NextResponse.json(
          { error: "This payment link is invalid or has expired." },
          { status: 404 }
        )
      }
      return NextResponse.json({
        data: {
          status: "tip",
          business_label: row.business_label || "Your service provider",
          customer_name: row.customer_name || "",
          base_cents: baseCents,
          subtotal_cents: row.subtotal_cents || baseCents,
          tax_cents: row.tax_cents || 0,
          note: row.note || "",
        },
      })
    }

    const resolved = await resolvePayLinkSession(key)
    if (!resolved) {
      // Row missing but token looked valid — tip-pending without migration columns.
      if (row) {
        const baseCents = Math.max(0, Math.round(row.charge_cents || 0))
        return NextResponse.json({
          data: {
            status: "tip",
            business_label: row.business_label || "Your service provider",
            customer_name: row.customer_name || "",
            base_cents: baseCents,
            subtotal_cents: baseCents,
            tax_cents: 0,
            note: "",
          },
        })
      }
      return NextResponse.json(
        { error: "This payment link is invalid or has expired." },
        { status: 404 }
      )
    }

    // Direct charges: wallets need lyncr.app on the connected account before Checkout mounts.
    await ensureStripeWalletPaymentMethodDomains({
      stripeAccount: resolved.stripeConnectAccountId,
    }).catch(() => null)

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
        stripe_account_id: resolved.stripeConnectAccountId,
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

type TipBody = {
  tipCents?: number
  tip_cents?: number
}

/** Customer confirmed tip — create Checkout for service+tax+tip (one charge). */
export async function POST(
  req: NextRequest,
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

  const body = (await req.json().catch(() => ({}))) as TipBody
  const tipCents = Math.max(
    0,
    Math.round(Number(body.tipCents ?? body.tip_cents ?? 0) || 0)
  )
  // Cap absurd custom tips (e.g. typo) — $5,000 tip max.
  if (tipCents > 500_000) {
    return NextResponse.json({ error: "Tip amount is too large." }, { status: 400 })
  }

  try {
    const result = await finalizeCollectPayLinkWithTip({ token: key, tipCents })

    await ensureStripeWalletPaymentMethodDomains({
      stripeAccount: result.stripeAccountId,
    }).catch(() => null)

    return NextResponse.json({
      data: {
        status: "open",
        client_secret: result.clientSecret,
        publishable_key: result.publishableKey,
        stripe_account_id: result.stripeAccountId,
        business_label: result.businessLabel,
        charge_cents: result.chargeCents,
        base_cents: result.baseCents,
        tip_cents: result.tipCents,
        customer_name: result.customerName,
        session_id: result.sessionId,
      },
    })
  } catch (e) {
    console.error("[POST /api/pay/token]", e)
    const message = e instanceof Error ? e.message : "Could not start payment."
    const status =
      /invalid|expired|already paid/i.test(message)
        ? 410
        : /Get paid|payout|under review/i.test(message)
          ? 403
          : 500
    return NextResponse.json({ error: message }, { status })
  }
}
