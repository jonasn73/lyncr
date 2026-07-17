import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { getStripeClient, getStripeWebhookSecret } from "@/lib/stripe-config"
import {
  handleStripeInvoicePaymentSucceeded,
  handleStripeSubscriptionCreated,
} from "@/lib/stripe-webhook-sync"
import { handleStripeCheckoutSessionCompleted } from "@/lib/stripe-billing-sync"
import { confirmJobPaymentIntent } from "@/lib/job-payments"

export const runtime = "nodejs"

/** Stripe billing + job PaymentIntent webhooks. */
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
      case "checkout.session.completed":
        await handleStripeCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session)
        break
      case "payment_intent.succeeded":
      case "payment_intent.payment_failed":
      case "payment_intent.canceled": {
        const intent = event.data.object as Stripe.PaymentIntent
        if (intent.metadata?.lyncr_kind === "job_payment") {
          await confirmJobPaymentIntent(intent.id)
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
