import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getStripeClient } from "@/lib/stripe-config"
import { applyStripeCreditPackPayment } from "@/lib/stripe-billing-sync"
import { provisionReservedLineAfterStripePayment } from "@/lib/stripe-webhook-sync"
import { resolveUserIdFromStripeCheckoutSession } from "@/lib/stripe-user-resolve"

/** Confirms a credit-pack checkout and optionally provisions the line if subscribed. */
export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { session_id?: string }
    const sessionId = body.session_id?.trim()
    if (!sessionId) {
      return NextResponse.json({ error: "session_id is required" }, { status: 400 })
    }

    const stripe = getStripeClient()
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    const ownerId = resolveUserIdFromStripeCheckoutSession(session)
    if (!ownerId || ownerId !== userId) {
      return NextResponse.json({ error: "Checkout session does not belong to this account." }, { status: 403 })
    }
    if (session.metadata?.checkout_type !== "credit_pack") {
      return NextResponse.json({ error: "Not a credit pack checkout session." }, { status: 400 })
    }

    const credit = await applyStripeCreditPackPayment(userId, session)
    let provision: Awaited<ReturnType<typeof provisionReservedLineAfterStripePayment>>
    try {
      provision = await provisionReservedLineAfterStripePayment(userId)
    } catch (provisionErr) {
      console.error("[billing/stripe/confirm-credit] provision after credit failed:", provisionErr)
      provision = {
        ok: false,
        error: provisionErr instanceof Error ? provisionErr.message : "Line provisioning failed after credit was added.",
      }
    }

    return NextResponse.json({
      data: {
        balance_after_cents: credit.balance_after_cents,
        telnyx_message: credit.telnyx_message,
        provisioned: provision.ok,
        phone_number: provision.ok ? provision.phone_number : null,
        provision_error: provision.ok ? null : provision.error,
        provision_reason: provision.ok ? null : provision.reason ?? null,
        unavailable_number: provision.ok ? null : provision.unavailable_number ?? null,
        area_code: provision.ok ? null : provision.area_code ?? null,
      },
    })
  } catch (e) {
    console.error("[billing/stripe/confirm-credit POST]", e)
    const msg = e instanceof Error ? e.message : "Could not confirm credit purchase"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
