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

/** Save-the-deal recovery step targets derived from the active quoted price. */
export function recoveryStepPrices(currentPriceDollars: number): {
  step1Price: number
  step2Price: number
  step3Price: number
} {
  const currentPriceVar = Math.max(0, Math.round(currentPriceDollars))
  return {
    step1Price: Math.max(currentPriceVar - 25, 45),
    step2Price: Math.round(currentPriceVar * 0.85),
    step3Price: Math.round(currentPriceVar * 0.75),
  }
}

export function routeMatchRecoveryScript(step1Price: number): string {
  return `I want to get you taken care of. If we can bypass immediate dispatch and book a flexible 2-hour window on an optimized route, I can authorize a special field reduction down to $${step1Price}. Does that keep us within your budget?`
}

export function aftermarketRecoveryScript(step2Price: number): string {
  return `I hear you. If you don't mind an aftermarket key instead of the premium factory fob, I can bypass the 12-month warranty tier. That cuts the hardware cost down and brings your total clean to $${step2Price} out the door. How does that sound?`
}

export function managementFloorRecoveryScript(
  customerName: string | null | undefined,
  step3Price: number
): string {
  const name = customerName?.trim() || "there"
  return `Look, ${name}, I want to help you out today. The absolute absolute lowest my supervisor will let me drop this ticket to cover our fuel and programming licensing costs is a flat $${step3Price}. I can lock that in right now if we can get your details taken care of.`
}
