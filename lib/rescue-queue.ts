// Price-denied rescue queue helpers for the scheduler hopper.

import { recoveryStepPrices } from "@/lib/price-negotiation"
import type { UnassignedPoolJob } from "@/lib/types"

/** True when the job is in the Price Denied / salvage outreach lane. */
export function isPriceDeniedRescueJob(job: {
  dispatch_status?: string | null
}): boolean {
  return (job.dispatch_status ?? "").trim().toLowerCase() === "salvage_pending"
}

/** Suggested rescue offer in cents (baseline minus ~15%). */
export function suggestRescueOfferPriceCents(job: UnassignedPoolJob): number {
  const baselineCents =
    job.baseline_quoted_price_cents != null && job.baseline_quoted_price_cents > 0
      ? job.baseline_quoted_price_cents
      : job.quoted_price_cents ?? 0
  const quotedCents = job.quoted_price_cents ?? baselineCents
  const anchorDollars = Math.max(
    0,
    Math.round((baselineCents > 0 ? baselineCents : quotedCents) / 100)
  )
  if (anchorDollars <= 0) return 0
  const { step2Price } = recoveryStepPrices(anchorDollars)
  return Math.max(0, Math.round(step2Price * 100))
}

/** Human dollars label for the rescue micro-input. */
export function suggestRescueOfferPriceDollars(job: UnassignedPoolJob): number {
  const cents = suggestRescueOfferPriceCents(job)
  return cents > 0 ? Math.round(cents / 100) : 0
}

/** Mock SMS body for a lower-price rescue follow-up. */
export function buildRescueOfferSmsPreview(params: {
  customerName?: string | null
  offerDollars: number
}): string {
  const name = params.customerName?.trim() || "there"
  return `Hi ${name} — we can still help today at $${params.offerDollars}. Reply YES to lock in this rate.`
}
