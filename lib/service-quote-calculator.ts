// Transparent locksmith pricing for the answered-call quick-booking sheet (DB-backed rate profiles).

import { formatIntakeJobTypeForDispatch, type IntakeLocksmithJobType } from "@/lib/intake-job-types"
import {
  DEFAULT_SERVICE_RATE_CARD,
  resolveServiceRateCard,
  type ServiceRateCard,
  type ServiceQuoteTypeId,
} from "@/lib/service-rate-card"
import { formatDistanceMiles } from "@/lib/geo"
import { type KeyStyleBucket } from "@/lib/vehicle-key-variant-labels"

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
  kind: "base_rate" | "vehicle_age_tier" | "premium_brand" | "distance_travel" | "key_blank" | "key_programming"
}

export type ServiceQuoteResult = {
  serviceTypeId: ServiceQuoteTypeId
  jobType: IntakeLocksmithJobType
  keyReplacementMode: string
  dispatchJobTypeLabel: string
  /** Base service rate in cents (before surcharges). */
  baseCents: number
  /** Travel premium in cents — distance × per-mile rate when miles are known. */
  distancePremiumCents: number
  /** Key blank / fob part cost from selected style or variant. */
  keyBlankCents: number
  /** OBD programming overhead when transponder or smart key applies. */
  programmingCents: number
  /** Base + travel + key blank + programming (primary auto-quote inputs). */
  autoTotalCents: number
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
  const perMileDollars = (rateCard.distance_per_mile_cents / 100).toFixed(2)
  const cents = Math.round(distanceMiles * rateCard.distance_per_mile_cents)
  return {
    cents,
    label: `${rateCard.distance_label} (${formatDistanceMiles(distanceMiles)} × $${perMileDollars}/mi)`,
  }
}

function classifyKeyStyleFromIntake(keyStyle: string): KeyStyleBucket {
  const style = keyStyle.trim().toLowerCase()
  if (!style || style.includes("not sure")) return "other"
  if (style.includes("push start") || style.includes("smart")) return "smart"
  if (style.includes("remote head")) return "remote_head"
  if (style.includes("flip")) return "flip"
  if (style.includes("keyless remote")) return "keyless_fob"
  if (style.includes("turn key") || style.includes("blade")) return "turn_key"
  return "other"
}

function keyStyleHasTransponder(bucket: KeyStyleBucket, chipset: string): boolean {
  if (chipset.trim()) return true
  return bucket === "smart" || bucket === "remote_head" || bucket === "flip" || bucket === "keyless_fob"
}

function isSmartKeySelection(bucket: KeyStyleBucket, keyStyle: string): boolean {
  if (bucket === "smart") return true
  return keyStyle.trim().toLowerCase().includes("push start")
}

function shouldApplyKeyHardwarePricing(
  serviceTypeId: ServiceQuoteTypeId,
  keyStyle: string,
  keyVariantId: string
): boolean {
  if (keyVariantId.trim()) return true
  const style = keyStyle.trim().toLowerCase()
  if (!style || style.includes("not sure")) return false
  return serviceTypeId === "key_gen" || serviceTypeId === "key_dup"
}

function keyHardwareSurcharges(
  params: {
    serviceTypeId: ServiceQuoteTypeId
    keyStyle?: string
    keyChipset?: string
    keyVariantId?: string
  },
  rateCard: ServiceRateCard
): {
  blankCents: number
  blankLabel: string
  programmingCents: number
  programmingLabel: string
} {
  const keyStyle = params.keyStyle?.trim() ?? ""
  const keyVariantId = params.keyVariantId?.trim() ?? ""
  if (!shouldApplyKeyHardwarePricing(params.serviceTypeId, keyStyle, keyVariantId)) {
    return {
      blankCents: 0,
      blankLabel: rateCard.key_blank_label,
      programmingCents: 0,
      programmingLabel: rateCard.key_programming_label,
    }
  }

  const bucket = classifyKeyStyleFromIntake(keyStyle)
  const smartKey = isSmartKeySelection(bucket, keyStyle)
  const hasTransponder = keyStyleHasTransponder(bucket, params.keyChipset?.trim() ?? "")

  let blankCents = 0
  let blankLabel = rateCard.key_blank_label
  if (smartKey || bucket === "keyless_fob") {
    blankCents = rateCard.key_blank_smart_cents
    blankLabel = "Smart key / prox fob blank"
  } else if (bucket === "remote_head" || bucket === "flip") {
    blankCents = rateCard.key_blank_high_security_cents
    blankLabel = "High-security / remote head blank"
  } else if (bucket === "turn_key" && hasTransponder) {
    blankCents = rateCard.key_blank_high_security_cents
    blankLabel = "Transponder blade blank"
  }

  const programmingCents = smartKey || hasTransponder ? rateCard.key_programming_cents : 0

  return {
    blankCents,
    blankLabel,
    programmingCents,
    programmingLabel: rateCard.key_programming_label,
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
  /** Selected key style from the vehicle key panel. */
  keyStyle?: string
  /** Transponder chipset from the FCC profile (when known). */
  keyChipset?: string
  /** Photo variant id when the operator tapped a specific key layout. */
  keyVariantId?: string
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
  const keyHardware = keyHardwareSurcharges(
    {
      serviceTypeId: params.serviceTypeId,
      keyStyle: params.keyStyle,
      keyChipset: params.keyChipset,
      keyVariantId: params.keyVariantId,
    },
    rateCard
  )

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
  if (keyHardware.blankCents > 0) {
    lines.push({ kind: "key_blank", label: keyHardware.blankLabel, cents: keyHardware.blankCents })
  }
  if (keyHardware.programmingCents > 0) {
    lines.push({
      kind: "key_programming",
      label: keyHardware.programmingLabel,
      cents: keyHardware.programmingCents,
    })
  }

  const distancePremiumCents = distanceTier.cents
  const keyBlankCents = keyHardware.blankCents
  const programmingCents = keyHardware.programmingCents
  const autoTotalCents = base + distancePremiumCents + keyBlankCents + programmingCents
  const totalCents = autoTotalCents + ageTier.cents + makeExtra

  return {
    serviceTypeId: spec.id,
    jobType: spec.jobType,
    keyReplacementMode: spec.keyMode,
    dispatchJobTypeLabel: formatIntakeJobTypeForDispatch(spec.jobType, spec.keyMode),
    baseCents: base,
    distancePremiumCents,
    keyBlankCents,
    programmingCents,
    autoTotalCents,
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
