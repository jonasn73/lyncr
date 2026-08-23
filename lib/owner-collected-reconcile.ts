// Server-only reconciliation of stale PENDING owner-collected rows against Stripe.
//
// This is intentionally split out of lib/owner-collected.ts: that file is statically imported
// by components/workspace-views/crm-workspace-view.tsx (a Client Component) for
// formatCollectedDollars/types, so anything in it that reaches stripe-connect.ts -> lib/db.ts
// pulls next/cache + fs into the client bundle and breaks the build. Only import this file from
// server-only contexts (API routes) — never from owner-collected.ts or any client component.

import {
  isStalePendingCollectedCharge,
  listOwnerCollectedTransactions,
  listOwnerCollectedTransactionsForPhone,
  type ListOwnerCollectedOptions,
  type OwnerCollectedTransaction,
} from "@/lib/owner-collected"

/**
 * A stale PENDING row usually means a genuinely abandoned Collect attempt, but it can also mean
 * a missed webhook delivery on a charge that actually succeeded (or actually failed) on Stripe
 * — in which case just hiding it makes real money invisible with no trail. Best-effort reconcile
 * a bounded number of stale rows against Stripe before the caller filters: a resolved charge
 * flips to COMPLETED/FAILED and stays visible either way; an unresolvable one (Stripe error,
 * Connect not ready) is left PENDING and still gets hidden as before rather than blocking the
 * whole list.
 */
const STALE_RECONCILE_MAX_PER_CALL = 5

async function reconcileStalePendingTransactions(
  ownerUserId: string,
  transactions: OwnerCollectedTransaction[]
): Promise<OwnerCollectedTransaction[]> {
  const stale = transactions.filter(
    (tx) => isStalePendingCollectedCharge(tx) && tx.stripePaymentIntentId
  )
  if (stale.length === 0) return transactions

  const { isStripeConfigured } = await import("@/lib/stripe-config")
  if (!isStripeConfigured()) return transactions

  let connectAccountId: string
  try {
    const { requireConnectReady } = await import("@/lib/stripe-connect")
    connectAccountId = (await requireConnectReady(ownerUserId)).accountId
  } catch {
    return transactions
  }

  const { confirmJobPaymentIntent } = await import("@/lib/job-payments")
  const resolved = new Map<string, "COMPLETED" | "FAILED">()
  for (const tx of stale.slice(0, STALE_RECONCILE_MAX_PER_CALL)) {
    try {
      const result = await confirmJobPaymentIntent(tx.stripePaymentIntentId!, {
        stripeConnectAccountId: connectAccountId,
      })
      if (result.status === "succeeded" || result.status === "already_completed") {
        resolved.set(tx.id, "COMPLETED")
      } else if (result.status === "failed") {
        resolved.set(tx.id, "FAILED")
      }
    } catch (e) {
      console.warn("[owner-collected-reconcile] stale pending reconcile failed:", tx.stripePaymentIntentId, e)
    }
  }
  if (resolved.size === 0) return transactions
  return transactions.map((tx) => (resolved.has(tx.id) ? { ...tx, status: resolved.get(tx.id)! } : tx))
}

/** Same as listOwnerCollectedTransactions, but reconciles stale PENDING rows against Stripe first. */
export async function listOwnerCollectedTransactionsReconciled(
  ownerUserId: string,
  limitOrOpts: number | ListOwnerCollectedOptions = 100
): Promise<OwnerCollectedTransaction[]> {
  const opts: ListOwnerCollectedOptions =
    typeof limitOrOpts === "number" ? { limit: limitOrOpts } : limitOrOpts ?? {}
  const unfiltered = await listOwnerCollectedTransactions(ownerUserId, {
    ...opts,
    includeStalePending: true,
  })
  const reconciled = await reconcileStalePendingTransactions(ownerUserId, unfiltered)
  return reconciled.filter((tx) => !isStalePendingCollectedCharge(tx))
}

/** Same as listOwnerCollectedTransactionsForPhone, but reconciles stale PENDING rows against Stripe first. */
export async function listOwnerCollectedTransactionsForPhoneReconciled(
  ownerUserId: string,
  phoneE164: string,
  limit = 50
): Promise<OwnerCollectedTransaction[]> {
  const unfiltered = await listOwnerCollectedTransactionsForPhone(ownerUserId, phoneE164, limit, true)
  const reconciled = await reconcileStalePendingTransactions(ownerUserId, unfiltered)
  return reconciled.filter((tx) => !isStalePendingCollectedCharge(tx))
}
