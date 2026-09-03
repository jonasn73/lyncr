// Stripe Connect payouts — list + manual “send to bank” for Get paid.

import type Stripe from "stripe"
import { getUser } from "@/lib/db"
import { getStripeClient, isStripeConfigured } from "@/lib/stripe-config"
import { getConnectReadyState, getConnectBalanceSummary } from "@/lib/stripe-connect"
import { recordWalletPayout } from "@/lib/tech-wallet"

export type ConnectPayoutRow = {
  id: string
  amountCents: number
  currency: string
  status: string
  arrivalDateLabel: string
  createdLabel: string
  method: string
  failureMessage: string | null
}

function fmtDay(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function mapPayout(p: Stripe.Payout): ConnectPayoutRow {
  return {
    id: p.id,
    amountCents: p.amount,
    currency: (p.currency || "usd").toLowerCase(),
    status: p.status || "unknown",
    arrivalDateLabel: p.arrival_date ? fmtDay(p.arrival_date) : "—",
    createdLabel: p.created ? fmtDay(p.created) : "—",
    method: p.method || "standard",
    failureMessage: p.failure_message?.trim() || null,
  }
}

/** Resolve the Connect account the acting user may payout from (owners only). */
async function resolveOwnerConnectAccount(userId: string): Promise<{
  accountId: string
  payoutsEnabled: boolean
}> {
  if (!isStripeConfigured()) {
    throw new Error("Stripe is not configured")
  }
  const user = await getUser(userId)
  if (!user) throw new Error("Not authenticated")
  if (user.account_role === "field_tech") {
    throw new Error("Ask the business owner to transfer funds from Bank & payouts.")
  }
  const state = await getConnectReadyState(userId)
  if (!state.accountId) {
    throw new Error("Finish bank setup before transferring to your bank.")
  }
  return {
    accountId: state.accountId,
    payoutsEnabled: state.row?.stripe_connect_payouts_enabled === true,
  }
}

/** Recent bank payouts for the shop’s Connect account. */
export async function listConnectPayouts(
  userId: string,
  limit = 20
): Promise<ConnectPayoutRow[]> {
  const { accountId } = await resolveOwnerConnectAccount(userId)
  const stripe = getStripeClient()
  const safeLimit = Math.min(50, Math.max(1, Math.floor(limit)))
  const list = await stripe.payouts.list({ limit: safeLimit }, { stripeAccount: accountId })
  return list.data.map(mapPayout)
}

/**
 * Send available Connect balance to the linked bank (standard payout).
 * Amount is in cents; omit / 0 = send the full available balance.
 */
export async function createConnectPayout(params: {
  userId: string
  amountCents?: number | null
}): Promise<ConnectPayoutRow> {
  const { accountId, payoutsEnabled } = await resolveOwnerConnectAccount(params.userId)
  if (!payoutsEnabled) {
    throw new Error(
      "Bank payouts are not enabled yet. Finish bank setup, or wait for Stripe to approve payouts."
    )
  }

  const bal = await getConnectBalanceSummary(accountId)
  if (bal.availableCents < 100) {
    throw new Error(
      "Nothing available to transfer yet. Pending charges usually become available in 1–2 business days."
    )
  }

  let amount = Math.round(Number(params.amountCents ?? 0) || 0)
  if (!amount || amount <= 0) {
    amount = bal.availableCents
  }
  if (amount < 100) {
    throw new Error("Minimum transfer is $1.00.")
  }
  if (amount > bal.availableCents) {
    throw new Error(
      `You only have ${(bal.availableCents / 100).toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
      })} available to transfer.`
    )
  }

  const stripe = getStripeClient()
  const payout = await stripe.payouts.create(
    {
      amount,
      currency: bal.currency || "usd",
      method: "standard",
      statement_descriptor: "LYNCR PAYOUT",
    },
    { stripeAccount: accountId }
  )

  // Awaited so the ledger balance reflects the payout before this request returns — recordWalletPayout
  // never throws (money already left Stripe; a ledger write failure must not read as a failed transfer).
  await recordWalletPayout({
    ownerUserId: params.userId,
    amountUsd: amount / 100,
    stripePayoutId: payout.id,
  })

  return mapPayout(payout)
}
