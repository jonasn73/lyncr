import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { getStripeClient, getStripeWebhookSecret } from "@/lib/stripe-config"
import {
  handleStripeInvoicePaymentSucceeded,
  handleStripeSubscriptionCreated,
} from "@/lib/stripe-webhook-sync"
import { confirmStripeCheckoutSession } from "@/lib/stripe-confirm-checkout"

export const runtime = "nodejs"

/** Stripe billing webhooks — subscription lifecycle + Telnyx provision after payment. */
export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get("stripe-signature")
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    const stripe = getStripeClient()
    event = stripe.webhooks.constructEvent(rawBody, signature, getStripeWebhookSecret())
  } catch (e) {
    console.error("[webhooks/stripe] signature verification failed", e)
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
        await handleStripeSubscriptionCreated(event.data.object as Stripe.Subscription)
        break
      case "invoice.payment_succeeded":
        await handleStripeInvoicePaymentSucceeded(event.data.object as Stripe.Invoice)
        break
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.mode !== "subscription") break
        const userId = session.metadata?.user_id?.trim()
        if (!userId || !session.id) break
        try {
          await confirmStripeCheckoutSession(userId, session.id)
        } catch (e) {
          console.error("[webhooks/stripe] checkout.session.completed sync failed", e)
        }
        break
      }
      default:
        break
    }
    return NextResponse.json({ received: true })
  } catch (e) {
    console.error("[webhooks/stripe]", event.type, e)
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 })
  }
}
