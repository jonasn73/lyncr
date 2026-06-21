// POST /api/messaging/10dlc/refresh — poll Telnyx/TCR for the latest campaign status,
// auto-assign the business line when approved, and (after a returning Stripe checkout)
// confirm payment so submission proceeds even if the webhook lagged.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  refreshMessaging10DlcStatus,
  handleMessaging10DlcPaid,
  getMessaging10DlcView,
} from "@/lib/messaging-10dlc"
import { confirmStripeCheckoutSession } from "@/lib/stripe-confirm-checkout"

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  try {
    const body = (await req.json().catch(() => ({}))) as { session_id?: string; organization_id?: string }
    const sessionId = body.session_id?.trim()
    const organizationId = body.organization_id?.trim() || undefined

    // If returning from Stripe checkout, confirm payment and kick off submission.
    if (sessionId) {
      try {
        await confirmStripeCheckoutSession(userId, sessionId)
      } catch (e) {
        // Fall back to direct handling if the generic confirm path didn't apply.
        console.warn("[10dlc] confirm session fallback:", e instanceof Error ? e.message : e)
        await handleMessaging10DlcPaid(userId, sessionId)
      }
    }

    await refreshMessaging10DlcStatus(userId, organizationId)
    const view = await getMessaging10DlcView(userId, organizationId)
    return NextResponse.json({ data: view })
  } catch (e) {
    console.error("[10dlc] refresh:", e)
    return NextResponse.json({ error: "Could not refresh status" }, { status: 500 })
  }
}
