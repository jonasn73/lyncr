/**
 * Job billing balance helpers — always prefer the persisted booked quote.
 * Active Job UI must not invent a new total from vehicle/key recalculation.
 */

/** Parse an editable dollars string into cents; null when empty/invalid. */
function parseEditablePriceDollarsToCents(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const dollars = Number.parseFloat(trimmed)
  if (!Number.isFinite(dollars) || dollars < 0) return null
  return Math.round(dollars * 100)
}

/**
 * Billing balance for Active Job / scheduler:
 * 1) operator-edited dollars field when present
 * 2) else the saved `quoted_price_cents` / booked total from the DB
 * Never falls back to a live calculator total.
 */
export function resolveJobBillingBalanceCents(opts: {
  editablePriceDollars: string
  savedQuotedPriceCents: number | null | undefined
}): number {
  const fromEdit = parseEditablePriceDollarsToCents(opts.editablePriceDollars)
  if (fromEdit != null && fromEdit > 0) return fromEdit
  const saved = opts.savedQuotedPriceCents
  if (saved != null && Number.isFinite(saved) && saved > 0) return Math.round(saved)
  // Allow an explicit $0 edit only when the field is non-empty.
  if (fromEdit === 0) return 0
  return 0
}

/** Baseline dollars shown under the balance — saved snapshot only. */
export function resolveJobBaselineDollars(
  savedBaselineCents: number | null | undefined
): number | null {
  if (savedBaselineCents == null || !Number.isFinite(savedBaselineCents) || savedBaselineCents <= 0) {
    return null
  }
  return Math.round(savedBaselineCents / 100)
}

/**
 * Prefer final booked → last quoted → quoted → column final → calculated baseline.
 * Used when mapping ai_leads rows into scheduler job shapes.
 */
export function pickPersistedJobQuoteCents(fields: {
  finalBookedTotalCents?: number | null
  lastQuotedPriceCents?: number | null
  quotedPriceCents?: number | null
  columnFinalBookedCents?: number | null
  pricingMetaQuotedCents?: number | null
}): number | null {
  const candidates = [
    fields.finalBookedTotalCents,
    fields.lastQuotedPriceCents,
    fields.quotedPriceCents,
    fields.columnFinalBookedCents,
    fields.pricingMetaQuotedCents,
  ]
  for (const c of candidates) {
    if (c != null && Number.isFinite(c) && c > 0) return Math.round(c)
  }
  return null
}

/**
 * Active Job overview billing balance — dollars from the persisted API job only.
 * Never invents a calculator total when an explicit amount is saved.
 */
export function billingBalanceDollarsFromJob(job: {
  quoted_price_cents?: number | null
  billing_balance_cents?: number | null
} | null | undefined): number {
  const cents = job?.billing_balance_cents ?? job?.quoted_price_cents
  if (cents == null || !Number.isFinite(cents) || cents <= 0) return 0
  return Math.round(cents / 100)
}

/**
 * Suggested booking deposit in cents for Money-on-the-job.
 * Rule: ~20% of balance, at least $25 when the job is large enough,
 * never more than the balance, and never below Stripe’s $0.50 floor.
 * Returns 0 when there is nothing collectible.
 */
export function suggestedJobDepositCents(balanceCents: number): number {
  if (!Number.isFinite(balanceCents) || balanceCents < 50) return 0
  const twentyPercent = Math.round(balanceCents * 0.2)
  // Prefer a meaningful deposit, but never overcharge the booked total.
  const withFloor = Math.max(2500, twentyPercent)
  return Math.min(withFloor, balanceCents)
}

/** Format cents as a short USD label for buttons/toasts (e.g. "$40"). */
export function formatJobMoneyCents(cents: number): string {
  if (!Number.isFinite(cents) || cents <= 0) return "$0"
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  })
}
