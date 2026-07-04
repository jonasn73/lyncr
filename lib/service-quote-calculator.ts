// Transparent locksmith pricing for the answered-call quick-booking sheet (DB-backed rate profiles).

import { formatIntakeJobTypeForDispatch, type IntakeLocksmithJobType } from "@/lib/intake-job-types"
import {
  DEFAULT_SERVICE_RATE_CARD,
  resolveServiceRateCard,
  type ServiceRateCard,
  type ServiceQuoteTypeId,
} from "@/lib/service-rate-card"
import { formatDistanceMiles } from "@/lib/geo"

/** Service types shown in the quote calculator (maps to intake job types). */
export const SERVICE_QUOTE_TYPES = [
  { id: "lockout", label: "Lockout", jobType: "Lockout" as IntakeLocksmithJobType, keyMode: "" },
  { id: "key_gen", label: "Key Generation", jobType: "Key replacement" as IntakeLocksmithJobType, keyMode: "Origination" },
  { id: "key_dup", label: "Key Duplication", jobType: "Key replacement" as IntakeLocksmithJobType, keyMode: "Duplication" },
  { id: "ignition", label: "Ignition Repair", jobType: "Ignition" as IntakeLocksmithJobType, keyMode: "" },
  { id: "other", label: "Other Service", jobType: "Other" as IntakeLocksmithJobType, keyMode: "" },
] as const

export type { ServiceQuoteTypeId } from "@/lib/service-rate-card"

export type ServiceQuoteBreakdownLine = {
  label: string
  cents: number
  kind: "base_rate" | "vehicle_age_tier" | "premium_brand" | "distance_travel"
}

export type ServiceQuoteResult = {
  serviceTypeId: ServiceQuoteTypeId
  jobType: IntakeLocksmithJobType
  keyReplacementMode: string
  dispatchJobTypeLabel: string
  totalCents: number
  lines: ServiceQuoteBreakdownLine[]
  rateCardSource: "onboarding_profiles.service_rules" | "default"
  /** Straight-line miles used for travel surcharge (null when unknown). */
  distanceMiles: number | null
}

function vehicleAgeYears(year: string): number | null {
  const y = Number.parseInt(year, 10)
  if (!Number.isFinite(y)) return null
  return Math.max(0, new Date().getFullYear() - y)
}

function vehicleAgeSurchargeCents(year: string, rateCard: ServiceRateCard): { cents: number; label: string } {
  const age = vehicleAgeYears(year)
  if (age == null) return { cents: 0, label: rateCard.vehicle_age_default_label }
  for (const tier of rateCard.vehicle_age_tiers) {
    if (age >= tier.min_age_years) {
      return {
        cents: tier.cents,
        label: tier.label?.trim() || rateCard.vehicle_age_default_label,
      }
    }
  }
  return { cents: 0, label: rateCard.vehicle_age_default_label }
}

function makeSurchargeCents(make: string, rateCard: ServiceRateCard): number {
  const key = make.trim().toLowerCase()
  if (!key) return 0
  const premium = new Set(rateCard.premium_makes.map((m) => m.trim().toLowerCase()))
  return premium.has(key) ? rateCard.premium_make_cents : 0
}

function distanceSurchargeCents(
  distanceMiles: number | null | undefined,
  rateCard: ServiceRateCard
): { cents: number; label: string } {
  if (distanceMiles == null || !Number.isFinite(distanceMiles) || distanceMiles <= 0) {
    return { cents: 0, label: rateCard.distance_label }
  }
  const included = rateCard.distance_included_miles
  const billableMiles = Math.max(0, distanceMiles - included)
  if (billableMiles <= 0) {
    return {
      cents: 0,
      label: `${rateCard.distance_label} (${formatDistanceMiles(distanceMiles)} — within ${included} mi included)`,
    }
  }
  const cents = Math.round(billableMiles * rateCard.distance_per_mile_cents)
  return {
    cents,
    label: `${rateCard.distance_label} (${formatDistanceMiles(distanceMiles)}, ${billableMiles.toFixed(1)} mi over ${included} mi included)`,
  }
}

/** Resolve a quote type id from intake job type + key mode strings. */
export function serviceQuoteTypeIdFromIntake(jobType: string, keyMode: string): ServiceQuoteTypeId {
  if (jobType === "Lockout") return "lockout"
  if (jobType === "Ignition") return "ignition"
  if (jobType === "Key replacement") {
    return keyMode === "Duplication" ? "key_dup" : "key_gen"
  }
  return "other"
}

/** Compute a live quote from YMM + service selection + optional owner rate profile. */
export function calculateServiceQuote(params: {
  serviceTypeId: ServiceQuoteTypeId
  vehicleYear?: string
  vehicleMake?: string
  vehicleModel?: string
  rateCard?: Partial<ServiceRateCard> | null
  rateCardSource?: "onboarding_profiles.service_rules" | "default"
  /** Straight-line miles from dispatcher to job site — adds travel surcharge when set. */
  distanceMiles?: number | null
}): ServiceQuoteResult {
  const rateCard = resolveServiceRateCard(params.rateCard)
  const source = params.rateCardSource ?? "default"
  const spec = SERVICE_QUOTE_TYPES.find((s) => s.id === params.serviceTypeId) ?? SERVICE_QUOTE_TYPES[0]
  const base = rateCard.services[spec.id] ?? DEFAULT_SERVICE_RATE_CARD.services[spec.id]
  const ageTier = vehicleAgeSurchargeCents(params.vehicleYear ?? "", rateCard)
  const makeExtra = makeSurchargeCents(params.vehicleMake ?? "", rateCard)
  const distanceMiles =
    params.distanceMiles != null && Number.isFinite(params.distanceMiles) && params.distanceMiles > 0
      ? params.distanceMiles
      : null
  const distanceTier = distanceSurchargeCents(distanceMiles, rateCard)

  const lines: ServiceQuoteBreakdownLine[] = [
    { kind: "base_rate", label: `${spec.label} base`, cents: base },
  ]
  if (ageTier.cents > 0) {
    lines.push({ kind: "vehicle_age_tier", label: ageTier.label, cents: ageTier.cents })
  }
  if (makeExtra > 0) {
    lines.push({ kind: "premium_brand", label: rateCard.premium_make_label, cents: makeExtra })
  }
  if (distanceTier.cents > 0) {
    lines.push({ kind: "distance_travel", label: distanceTier.label, cents: distanceTier.cents })
  }

  const totalCents = base + ageTier.cents + makeExtra + distanceTier.cents

  return {
    serviceTypeId: spec.id,
    jobType: spec.jobType,
    keyReplacementMode: spec.keyMode,
    dispatchJobTypeLabel: formatIntakeJobTypeForDispatch(spec.jobType, spec.keyMode),
    totalCents,
    lines,
    rateCardSource: source,
    distanceMiles,
  }
}

export function formatQuoteDollars(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`
}

// Re-export for callers that need the default profile without a DB round-trip.
export { DEFAULT_SERVICE_RATE_CARD, type ServiceRateCard } from "@/lib/service-rate-card"
