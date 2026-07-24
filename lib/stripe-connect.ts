// Stripe Connect Express — in-app “Get paid” onboarding + Collect Payment routing.

import type Stripe from "stripe"
import { getStripeClient, isStripeConfigured } from "@/lib/stripe-config"
import {
  getUser,
  getUserIdByStripeConnectAccountId,
  getUserStripeConnect,
  updateUserStripeConnect,
  type UserStripeConnectRow,
} from "@/lib/db"

export const CONNECT_NOT_READY_MESSAGE =
  "Finish Get paid in Settings before accepting card payments. Customers pay your business — funds go to your bank."

/** Lyncr platform fee: 2.9% + $0.30 (overridable via env). */
export function computeLyncrApplicationFeeCents(chargeCents: number): number {
  const amount = Math.max(0, Math.round(chargeCents))
  if (amount <= 0) return 0
  const bpsRaw = Number(process.env.LYNCR_PAYMENT_FEE_BPS ?? "290")
  const flatRaw = Number(process.env.LYNCR_PAYMENT_FEE_FLAT_CENTS ?? "30")
  const bps = Number.isFinite(bpsRaw) && bpsRaw >= 0 ? bpsRaw : 290
  const flat = Number.isFinite(flatRaw) && flatRaw >= 0 ? Math.round(flatRaw) : 30
  const fee = Math.round((amount * bps) / 10000) + flat
  // Never take more than the charge (Stripe rejects application_fee >= amount).
  return Math.min(amount - 1, Math.max(0, fee))
}

export type ConnectReady = {
  ready: true
  accountId: string
  row: UserStripeConnectRow
}

export type ConnectNotReady = {
  ready: false
  accountId: string | null
  row: UserStripeConnectRow | null
  reason: string
}

export type ConnectReadyResult = ConnectReady | ConnectNotReady

/** True when the shop can accept Collect Payment card charges. */
export function isConnectChargesReady(row: UserStripeConnectRow | null | undefined): boolean {
  return Boolean(row?.stripe_connect_account_id && row.stripe_connect_charges_enabled)
}

/**
 * Ensure the owner has Connect charges enabled. Throws CONNECT_NOT_READY_MESSAGE otherwise.
 * Field techs must pass the **job owner** user id.
 */
export async function requireConnectReady(ownerUserId: string): Promise<ConnectReady> {
  const result = await getConnectReadyState(ownerUserId)
  if (!result.ready) {
    throw new Error(result.reason || CONNECT_NOT_READY_MESSAGE)
  }
  return result
}

export async function getConnectReadyState(ownerUserId: string): Promise<ConnectReadyResult> {
  const uid = ownerUserId.trim()
  if (!uid) {
    return {
      ready: false,
      accountId: null,
      row: null,
      reason: CONNECT_NOT_READY_MESSAGE,
    }
  }
  // Refresh flags from Stripe when we have an account id (best-effort).
  let row = await getUserStripeConnect(uid)
  if (row?.stripe_connect_account_id && isStripeConfigured()) {
    try {
      row = (await syncConnectAccountFromStripe(uid, row.stripe_connect_account_id)) ?? row
    } catch (e) {
      console.warn("[stripe-connect] sync before ready check:", e)
    }
  }
  if (!row?.stripe_connect_account_id) {
    return {
      ready: false,
      accountId: null,
      row,
      reason: CONNECT_NOT_READY_MESSAGE,
    }
  }
  if (!row.stripe_connect_charges_enabled) {
    return {
      ready: false,
      accountId: row.stripe_connect_account_id,
      row,
      reason: row.stripe_connect_details_submitted
        ? "Your payout account is still under review. You can collect once Stripe enables charges."
        : CONNECT_NOT_READY_MESSAGE,
    }
  }
  return {
    ready: true,
    accountId: row.stripe_connect_account_id,
    row,
  }
}

/** Create an Express connected account for this Lyncr user (idempotent). */
export async function ensureStripeConnectAccount(userId: string): Promise<string> {
  if (!isStripeConfigured()) {
    throw new Error("Stripe is not configured (STRIPE_SECRET_KEY)")
  }
  const user = await getUser(userId)
  if (!user) throw new Error("User not found")
  if (user.account_role === "field_tech") {
    throw new Error("Field techs use the business payout account — ask the owner to open Get paid.")
  }

  const existing = await getUserStripeConnect(userId)
  if (existing?.stripe_connect_account_id) {
    return existing.stripe_connect_account_id
  }

  const stripe = getStripeClient()
  const account = await stripe.accounts.create({
    type: "express",
    country: "US",
    email: user.email?.trim() || undefined,
    business_profile: {
      name: user.business_name?.trim() || user.name?.trim() || undefined,
      product_description: "On-site service payments collected via Lyncr",
    },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    metadata: {
      lyncr_user_id: userId,
    },
  })

  await updateUserStripeConnect(userId, {
    stripeConnectAccountId: account.id,
    chargesEnabled: account.charges_enabled === true,
    payoutsEnabled: account.payouts_enabled === true,
    detailsSubmitted: account.details_submitted === true,
  })

  return account.id
}

/** Account Session client_secret for embedded onboarding / account management. */
export async function createConnectAccountSession(
  userId: string,
  components: "onboarding" | "management" | "both" = "both"
): Promise<{ clientSecret: string; accountId: string }> {
  const accountId = await ensureStripeConnectAccount(userId)
  const stripe = getStripeClient()

  const wantOnboarding = components === "onboarding" || components === "both"
  const wantManagement = components === "management" || components === "both"

  const session = await stripe.accountSessions.create({
    account: accountId,
    components: {
      account_onboarding: wantOnboarding
        ? {
            enabled: true,
            features: {
              external_account_collection: true,
            },
          }
        : { enabled: false },
      account_management: wantManagement
        ? {
            enabled: true,
            features: {
              external_account_collection: true,
            },
          }
        : { enabled: false },
    },
  })

  if (!session.client_secret) {
    throw new Error("Stripe did not return an Account Session client_secret")
  }

  return { clientSecret: session.client_secret, accountId }
}

/** Pull capability flags from Stripe into Neon. */
export async function syncConnectAccountFromStripe(
  userId: string,
  accountId?: string
): Promise<UserStripeConnectRow | null> {
  if (!isStripeConfigured()) return getUserStripeConnect(userId)
  const stripe = getStripeClient()
  const row = await getUserStripeConnect(userId)
  const acct = (accountId || row?.stripe_connect_account_id || "").trim()
  if (!acct) return row

  const account = await stripe.accounts.retrieve(acct)
  return updateUserStripeConnect(userId, {
    stripeConnectAccountId: account.id,
    chargesEnabled: account.charges_enabled === true,
    payoutsEnabled: account.payouts_enabled === true,
    detailsSubmitted: account.details_submitted === true,
  })
}

/** Webhook: account.updated → refresh the matching Lyncr user. */
export async function handleStripeConnectAccountUpdated(
  account: Stripe.Account
): Promise<void> {
  const fromMeta = account.metadata?.lyncr_user_id?.trim()
  const userId =
    fromMeta || (await getUserIdByStripeConnectAccountId(account.id)) || null
  if (!userId) {
    console.warn("[stripe-connect] account.updated with no Lyncr user", account.id)
    return
  }
  await updateUserStripeConnect(userId, {
    stripeConnectAccountId: account.id,
    chargesEnabled: account.charges_enabled === true,
    payoutsEnabled: account.payouts_enabled === true,
    detailsSubmitted: account.details_submitted === true,
  })
}

export type ConnectBalanceSummary = {
  availableCents: number
  pendingCents: number
  currency: string
}

/** Available / pending balance on the connected account (USD preferred). */
export async function getConnectBalanceSummary(
  accountId: string
): Promise<ConnectBalanceSummary> {
  const stripe = getStripeClient()
  const balance = await stripe.balance.retrieve({
    stripeAccount: accountId,
  })

  const sum = (buckets: Stripe.Balance.Available[] | Stripe.Balance.Pending[]) =>
    buckets
      .filter((b) => (b.currency || "").toLowerCase() === "usd")
      .reduce((acc, b) => acc + (b.amount || 0), 0)

  const availableUsd = sum(balance.available || [])
  const pendingUsd = sum(balance.pending || [])
  // If no USD line items, fall back to first currency totals.
  if (availableUsd === 0 && pendingUsd === 0) {
    const avail = (balance.available || [])[0]
    const pend = (balance.pending || [])[0]
    return {
      availableCents: avail?.amount ?? 0,
      pendingCents: pend?.amount ?? 0,
      currency: (avail?.currency || pend?.currency || "usd").toLowerCase(),
    }
  }
  return {
    availableCents: availableUsd,
    pendingCents: pendingUsd,
    currency: "usd",
  }
}

/**
 * Options for PaymentIntents / Checkout charged on the connected account
 * (customer bank statement shows the shop; Lyncr takes application_fee).
 */
export function connectDirectChargeOptions(accountId: string): { stripeAccount: string } {
  return { stripeAccount: accountId }
}
