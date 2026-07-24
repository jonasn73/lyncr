// GET /api/payments/connect/status
// Connect readiness + available/pending balance for Get paid UI.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUser } from "@/lib/db"
import { isStripeConfigured } from "@/lib/stripe-config"
import {
  computeLyncrApplicationFeeCents,
  getConnectBalanceSummary,
  getConnectReadyState,
  syncConnectAccountFromStripe,
} from "@/lib/stripe-connect"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  // Field techs: report the owner's Connect status when ?ownerId= is not needed —
  // for Collect gate they call with their session; status is for owners primarily.
  const statusUserId = userId

  if (!isStripeConfigured()) {
    return NextResponse.json({
      data: {
        configured: false,
        ready: false,
        status: "not_configured" as const,
        accountId: null,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        availableCents: 0,
        pendingCents: 0,
        currency: "usd",
        feeExampleCents: computeLyncrApplicationFeeCents(10000),
        feeLabel: "2.9% + $0.30 per card payment",
        message: "Stripe is not configured on this server.",
      },
    })
  }

  try {
    const state = await getConnectReadyState(statusUserId)
    if (state.accountId) {
      await syncConnectAccountFromStripe(statusUserId, state.accountId).catch(() => null)
    }
    const refreshed = await getConnectReadyState(statusUserId)
    const row = refreshed.row

    let availableCents = 0
    let pendingCents = 0
    let currency = "usd"
    if (refreshed.accountId) {
      try {
        const bal = await getConnectBalanceSummary(refreshed.accountId)
        availableCents = bal.availableCents
        pendingCents = bal.pendingCents
        currency = bal.currency
      } catch (e) {
        console.warn("[payments/connect/status] balance:", e)
      }
    }

    const status = refreshed.ready
      ? ("ready" as const)
      : row?.stripe_connect_details_submitted
        ? ("under_review" as const)
        : row?.stripe_connect_account_id
          ? ("needs_setup" as const)
          : ("needs_setup" as const)

    return NextResponse.json({
      data: {
        configured: true,
        ready: refreshed.ready,
        status,
        accountId: refreshed.accountId,
        chargesEnabled: row?.stripe_connect_charges_enabled === true,
        payoutsEnabled: row?.stripe_connect_payouts_enabled === true,
        detailsSubmitted: row?.stripe_connect_details_submitted === true,
        availableCents,
        pendingCents,
        currency,
        feeExampleCents: computeLyncrApplicationFeeCents(10000),
        feeLabel: "2.9% + $0.30 per card payment",
        message: refreshed.ready ? null : refreshed.reason,
      },
    })
  } catch (e) {
    console.error("[payments/connect/status]", e)
    const message = e instanceof Error ? e.message : "Could not load payout status"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
