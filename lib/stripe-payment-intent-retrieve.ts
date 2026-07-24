// Retrieve PaymentIntents that may live on a Stripe Connect account (direct charges).

import type Stripe from "stripe"
import { getUserStripeConnect } from "@/lib/db"
import { getStripeClient } from "@/lib/stripe-config"

function isMissingPaymentIntentError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  const code =
    e && typeof e === "object" && "code" in e ? String((e as { code?: string }).code || "") : ""
  return (
    code === "resource_missing" ||
    /no such payment_intent/i.test(msg) ||
    /resource_missing/i.test(msg)
  )
}

export type RetrievedLyncrPaymentIntent = {
  intent: Stripe.PaymentIntent
  /** Connected account id used for the retrieve, or null when on the platform. */
  stripeConnectAccountId: string | null
}

/**
 * Load a PaymentIntent, trying the connected account when the charge was a Connect
 * direct charge (platform retrieve alone returns "No such payment_intent").
 */
export async function retrieveLyncrPaymentIntent(
  paymentIntentId: string,
  opts?: {
    stripeConnectAccountId?: string | null
    /** Used to look up the shop's Connect account when the client did not pass one. */
    ownerUserId?: string | null
  }
): Promise<RetrievedLyncrPaymentIntent> {
  const pi = paymentIntentId.trim()
  if (!pi) throw new Error("paymentIntentId is required")

  const stripe = getStripeClient()
  const hinted = (opts?.stripeConnectAccountId || "").trim() || null
  const ownerUserId = (opts?.ownerUserId || "").trim() || null

  const candidates: Array<string | null> = []
  // Prefer the Connect account from create-intent — direct charges never live on platform.
  if (hinted) candidates.push(hinted)
  if (ownerUserId) {
    const row = await getUserStripeConnect(ownerUserId)
    const acct = row?.stripe_connect_account_id?.trim() || null
    if (acct && acct !== hinted) candidates.push(acct)
  }
  // Platform last (destination charges / legacy non-Connect intents).
  candidates.push(null)

  let lastError: unknown = null
  for (const acct of candidates) {
    try {
      const intent = await stripe.paymentIntents.retrieve(
        pi,
        acct ? { stripeAccount: acct } : undefined
      )
      // Platform retrieve can succeed for destination charges that still name a Connect acct.
      const metaAcct = (intent.metadata?.stripe_connect_account_id || "").trim()
      if (!acct && metaAcct) {
        try {
          const onConnect = await stripe.paymentIntents.retrieve(pi, {
            stripeAccount: metaAcct,
          })
          return { intent: onConnect, stripeConnectAccountId: metaAcct }
        } catch {
          return { intent, stripeConnectAccountId: metaAcct }
        }
      }
      return { intent, stripeConnectAccountId: acct }
    } catch (e) {
      lastError = e
      if (!isMissingPaymentIntentError(e)) throw e
      // Try next candidate (Connect vs platform).
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("No such payment_intent")
}
