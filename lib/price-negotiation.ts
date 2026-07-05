// Quick discount presets for dispatch price negotiation (intake + job editor).

export type NegotiationDiscountId =
  | "aftermarket_key_swap"
  | "route_optimization"
  | "first_time_callback"

export type NegotiationDiscountOption = {
  id: NegotiationDiscountId
  label: string
  shortLabel: string
}

export const NEGOTIATION_DISCOUNT_OPTIONS: NegotiationDiscountOption[] = [
  {
    id: "aftermarket_key_swap",
    label: "Standard/Aftermarket Key Swap (-$40)",
    shortLabel: "Aftermarket key swap",
  },
  {
    id: "route_optimization",
    label: "Route Optimization / Flexible ETA (-$25)",
    shortLabel: "Route optimization",
  },
  {
    id: "first_time_callback",
    label: "First-Time Callback Code (-10%)",
    shortLabel: "First-time callback",
  },
]

export function negotiationDiscountLabel(id: NegotiationDiscountId | string | null | undefined): string | null {
  if (!id) return null
  return NEGOTIATION_DISCOUNT_OPTIONS.find((o) => o.id === id)?.shortLabel ?? id
}

/** Parse the editable quote field into whole dollars (falls back to baseline). */
export function parseQuoteDollars(raw: string, fallbackCents: number): number {
  const trimmed = raw.trim()
  if (!trimmed) return Math.max(0, Math.round(fallbackCents / 100))
  const dollars = Number.parseFloat(trimmed)
  if (!Number.isFinite(dollars) || dollars < 0) return Math.max(0, Math.round(fallbackCents / 100))
  return Math.round(dollars)
}

/** Apply a negotiation preset to the current quoted dollars. */
export function applyNegotiationDiscount(params: {
  discountId: NegotiationDiscountId
  currentPriceDollars: number
  baselineCents: number
}): number {
  const current = params.currentPriceDollars
  const baselineDollars = Math.max(0, Math.round(params.baselineCents / 100))
  switch (params.discountId) {
    case "aftermarket_key_swap":
      return Math.max(0, current - 40)
    case "route_optimization":
      return Math.max(0, current - 25)
    case "first_time_callback":
      return Math.max(0, Math.round(baselineDollars * 0.9))
    default:
      return current
  }
}

/** Authorized route-match recovery price pitched when customer says quote is too high. */
export const ROUTE_MATCH_RECOVERY_PRICE_DOLLARS = 265

export const ROUTE_MATCH_RECOVERY_SCRIPT =
  'I want to get you taken care of. If we can bypass immediate dispatch and book a flexible 2-hour window on an optimized route, I can authorize a special field reduction down to $265. Does that keep us within your budget?'
