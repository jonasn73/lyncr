// Transparent locksmith pricing for the answered-call quick-booking sheet (DB-backed rate profiles).

import { formatIntakeJobTypeForDispatch, type IntakeLocksmithJobType } from "@/lib/intake-job-types"
import {
  DEFAULT_SERVICE_RATE_CARD,
  normalizeServiceQuoteTypeId,
  resolveServiceRateCard,
  type ServiceRateCard,
  type ServiceQuoteTypeId,
} from "@/lib/service-rate-card"
import { formatDistanceMiles } from "@/lib/geo"
import { type KeyStyleBucket } from "@/lib/vehicle-key-variant-labels"

/** Service types shown in the quote calculator (maps to intake job types). */
export const SERVICE_QUOTE_TYPES = [
  { id: "lockout", label: "Lockout", jobType: "Lockout" as IntakeLocksmithJobType, keyMode: "", dispatchLabel: "Lockout" },
  {
    id: "key_generation",
    label: "Key Generation (AKL)",
    jobType: "Key replacement" as IntakeLocksmithJobType,
    keyMode: "Origination",
    dispatchLabel: "Key replacement — Origination",
  },
  {
    id: "key_duplication",
    label: "Key Duplication (Spare)",
    jobType: "Key replacement" as IntakeLocksmithJobType,
    keyMode: "Duplication",
    dispatchLabel: "Key replacement — Duplication",
  },
  {
    id: "programming_diagnostics",
    label: "Programming / Immobilizer Reset",
    jobType: "Other" as IntakeLocksmithJobType,
    keyMode: "",
    dispatchLabel: "Programming / Immobilizer Reset",
  },
  {
    id: "ignition_repair",
    label: "Ignition Repair / Replace",
    jobType: "Ignition" as IntakeLocksmithJobType,
    keyMode: "",
    dispatchLabel: "Ignition Repair / Replace",
  },
  {
    id: "key_extraction",
    label: "Broken Key Extraction",
    jobType: "Other" as IntakeLocksmithJobType,
    keyMode: "",
    dispatchLabel: "Broken Key Extraction",
  },
  {
    id: "rekey",
    label: "Lock Re-keying",
    jobType: "Other" as IntakeLocksmithJobType,
    keyMode: "",
    dispatchLabel: "Lock Re-keying",
  },
  {
    id: "lock_installation",
    label: "Lock Installation / Change",
    jobType: "Other" as IntakeLocksmithJobType,
    keyMode: "",
    dispatchLabel: "Lock Installation / Change",
  },
  {
    id: "safe_lockout",
    label: "Safe Lockout",
    jobType: "Other" as IntakeLocksmithJobType,
    keyMode: "",
    dispatchLabel: "Safe Lockout",
  },
  {
    id: "keypad_smart_lock",
    label: "Keypad Smart Lock Install",
    jobType: "Other" as IntakeLocksmithJobType,
    keyMode: "",
    dispatchLabel: "Keypad Smart Lock Install",
  },
  {
    id: "commercial_hardware",
    label: "Commercial Access Hardware",
    jobType: "Other" as IntakeLocksmithJobType,
    keyMode: "",
    dispatchLabel: "Commercial Access Hardware",
  },
  {
    id: "master_key_system",
    label: "Master Key System Setup",
    jobType: "Other" as IntakeLocksmithJobType,
    keyMode: "",
    dispatchLabel: "Master Key System Setup",
  },
  {
    id: "door_closer_repair",
    label: "Door Closer Repair",
    jobType: "Other" as IntakeLocksmithJobType,
    keyMode: "",
    dispatchLabel: "Door Closer Repair",
  },
  { id: "other", label: "Other Service", jobType: "Other" as IntakeLocksmithJobType, keyMode: "", dispatchLabel: "Other Service" },
] as const

/** Service types that require year / make / model (and optional VIN) on the edit form. */
export const AUTOMOTIVE_SERVICE_QUOTE_TYPE_IDS = [
  "key_generation",
  "key_duplication",
  "programming_diagnostics",
  "ignition_repair",
  "key_extraction",
] as const satisfies readonly ServiceQuoteTypeId[]

/** True when the selected service needs vehicle identity fields in the scheduler edit form. */
export function isAutomotiveServiceQuoteType(
  serviceTypeId: ServiceQuoteTypeId | string | null | undefined
): boolean {
  const normalized = normalizeServiceQuoteTypeId(serviceTypeId ?? "")
  return (AUTOMOTIVE_SERVICE_QUOTE_TYPE_IDS as readonly string[]).includes(normalized)
}

export type { ServiceQuoteTypeId } from "@/lib/service-rate-card"
export { normalizeServiceQuoteTypeId } from "@/lib/service-rate-card"

export type ServiceQuoteBreakdownLine = {
  label: string
  cents: number
  kind:
    | "base_rate"
    | "vehicle_age_tier"
    | "premium_brand"
    | "distance_travel"
    | "key_blank"
    | "key_programming"
    | "high_security_risk"
}

/** Vehicle difficulty tier used for dynamic blank / programming / risk fees. */
export type VehiclePricingTier = "tier1" | "tier2" | "tier3"

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
  /** Tier-3 key-generation risk premium (cents); 0 when not applied. */
  highSecurityRiskCents: number
  /** Resolved difficulty tier from year / make / model (+ key style when known). */
  pricingTier: VehiclePricingTier
  /** Base + travel + key blank + programming (+ tier-3 risk when applied). */
  autoTotalCents: number
  totalCents: number
  lines: ServiceQuoteBreakdownLine[]
  rateCardSource: "onboarding_profiles.service_rules" | "default"
  /** Straight-line miles used for travel surcharge (null when unknown). */
  distanceMiles: number | null
}

/** Makes that jump to tier3 for 2018+ smart / prox keys. */
const TIER3_SMART_MAKES_2018 = new Set(["subaru", "toyota", "lexus", "honda"])

/**
 * Resolve vehicle difficulty tier for dynamic pricing.
 * - tier3: year >= 2020, or Subaru/Toyota/Lexus/Honda 2018+ with smart/prox
 * - tier2: smart/prox that does not meet tier3
 * - tier1: standard transponder / metal key
 */
export function getVehiclePricingTier(
  year: string | number | null | undefined,
  make: string | null | undefined,
  _model?: string | null | undefined,
  keyStyle?: string | null
): VehiclePricingTier {
  const y = typeof year === "number" ? year : Number.parseInt(String(year ?? "").trim(), 10)
  const yearOk = Number.isFinite(y)
  const makeKey = String(make ?? "")
    .trim()
    .toLowerCase()
  const style = String(keyStyle ?? "").trim().toLowerCase()
  const bucket = classifyKeyStyleFromIntake(style)
  const isSmartOrProx =
    isSmartKeySelection(bucket, style) ||
    bucket === "keyless_fob" ||
    style.includes("prox") ||
    style.includes("smart key")

  // Late-model / high-security vehicles.
  if (yearOk && y >= 2020) return "tier3"
  if (
    yearOk &&
    y >= 2018 &&
    isSmartOrProx &&
    TIER3_SMART_MAKES_2018.has(makeKey)
  ) {
    return "tier3"
  }

  if (isSmartOrProx) return "tier2"
  return "tier1"
}

/** Dollar defaults (as cents) for blank + programming by difficulty tier. */
export function feesForVehiclePricingTier(tier: VehiclePricingTier): {
  blankCents: number
  programmingCents: number
  highSecurityRiskCents: number
} {
  switch (tier) {
    case "tier3":
      return {
        blankCents: 12000, // $120 smart key blank
        programmingCents: 12500, // $125 OBD / gateway bypass
        highSecurityRiskCents: 5000, // $50 key-generation premium
      }
    case "tier2":
      return {
        blankCents: 6000, // $60
        programmingCents: 6500, // $65
        highSecurityRiskCents: 0,
      }
    default:
      return {
        blankCents: 2500, // $25
        programmingCents: 4500, // $45
        highSecurityRiskCents: 0,
      }
  }
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
  return serviceTypeId === "key_generation" || serviceTypeId === "key_duplication"
}

function keyHardwareSurcharges(
  params: {
    serviceTypeId: ServiceQuoteTypeId
    vehicleYear?: string
    vehicleMake?: string
    vehicleModel?: string
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
  pricingTier: VehiclePricingTier
} {
  const keyStyle = params.keyStyle?.trim() ?? ""
  const keyVariantId = params.keyVariantId?.trim() ?? ""
  const pricingTier = getVehiclePricingTier(
    params.vehicleYear,
    params.vehicleMake,
    params.vehicleModel,
    keyStyle
  )

  if (!shouldApplyKeyHardwarePricing(params.serviceTypeId, keyStyle, keyVariantId)) {
    return {
      blankCents: 0,
      blankLabel: rateCard.key_blank_label,
      programmingCents: 0,
      programmingLabel: rateCard.key_programming_label,
      pricingTier,
    }
  }

  const bucket = classifyKeyStyleFromIntake(keyStyle)
  const smartKey = isSmartKeySelection(bucket, keyStyle)
  const hasTransponder = keyStyleHasTransponder(bucket, params.keyChipset?.trim() ?? "")
  const tierFees = feesForVehiclePricingTier(pricingTier)

  // Labels stay descriptive; dollar amounts come from the vehicle difficulty tier.
  let blankLabel = rateCard.key_blank_label
  if (smartKey || bucket === "keyless_fob") {
    blankLabel = "Smart key / prox fob blank"
  } else if (bucket === "remote_head" || bucket === "flip") {
    blankLabel = "High-security / remote head blank"
  } else if (bucket === "turn_key" && hasTransponder) {
    blankLabel = "Transponder blade blank"
  } else if (bucket === "turn_key") {
    blankLabel = "Metal / blade key blank"
  }

  // Once a key style/variant is known, apply the full tier blank + programming defaults.
  return {
    blankCents: tierFees.blankCents,
    blankLabel,
    programmingCents: tierFees.programmingCents,
    programmingLabel: rateCard.key_programming_label,
    pricingTier,
  }
}

/** Resolve a quote type id from intake job type + key mode strings. */
export function serviceQuoteTypeIdFromIntake(jobType: string, keyMode: string): ServiceQuoteTypeId {
  if (jobType === "Lockout") return "lockout"
  if (jobType === "Ignition") return "ignition_repair"
  if (jobType === "Key replacement") {
    return keyMode === "Duplication" ? "key_duplication" : "key_generation"
  }
  const normalizedJob = jobType.trim().toLowerCase()
  if (normalizedJob.includes("programming") || normalizedJob.includes("immobilizer")) {
    return "programming_diagnostics"
  }
  if (normalizedJob.includes("extraction")) return "key_extraction"
  if (normalizedJob.includes("re-key") || normalizedJob.includes("rekey")) return "rekey"
  if (normalizedJob.includes("installation") || normalizedJob.includes("lock change")) {
    return "lock_installation"
  }
  if (normalizedJob.includes("safe")) return "safe_lockout"
  if (normalizedJob.includes("keypad") || normalizedJob.includes("smart lock")) return "keypad_smart_lock"
  if (normalizedJob.includes("master key")) return "master_key_system"
  if (normalizedJob.includes("door closer")) return "door_closer_repair"
  if (normalizedJob.includes("commercial")) return "commercial_hardware"
  return "other"
}

function findServiceQuoteSpec(serviceTypeId: ServiceQuoteTypeId) {
  const normalized = normalizeServiceQuoteTypeId(serviceTypeId)
  return SERVICE_QUOTE_TYPES.find((s) => s.id === normalized) ?? SERVICE_QUOTE_TYPES[0]
}

/** Compute a live quote from YMM + service selection + optional owner rate profile. */
export function calculateServiceQuote(params: {
  serviceTypeId: ServiceQuoteTypeId | string
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
  const normalizedServiceTypeId = normalizeServiceQuoteTypeId(String(params.serviceTypeId))
  const rateCard = resolveServiceRateCard(params.rateCard)
  const source = params.rateCardSource ?? "default"
  const spec = findServiceQuoteSpec(normalizedServiceTypeId)
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
      serviceTypeId: normalizedServiceTypeId,
      vehicleYear: params.vehicleYear,
      vehicleMake: params.vehicleMake,
      vehicleModel: params.vehicleModel,
      keyStyle: params.keyStyle,
      keyChipset: params.keyChipset,
      keyVariantId: params.keyVariantId,
    },
    rateCard
  )

  // Tier 3 key generation: gateway / immobilizer risk premium on the job base.
  const tierFees = feesForVehiclePricingTier(keyHardware.pricingTier)
  const highSecurityRiskCents =
    keyHardware.pricingTier === "tier3" && normalizedServiceTypeId === "key_generation"
      ? tierFees.highSecurityRiskCents
      : 0

  const lines: ServiceQuoteBreakdownLine[] = [
    { kind: "base_rate", label: `${spec.label} base`, cents: base },
  ]
  if (highSecurityRiskCents > 0) {
    lines.push({
      kind: "high_security_risk",
      label: "High-Security Risk Premium",
      cents: highSecurityRiskCents,
    })
  }
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
  const autoTotalCents =
    base + distancePremiumCents + keyBlankCents + programmingCents + highSecurityRiskCents
  const totalCents = autoTotalCents + ageTier.cents + makeExtra

  return {
    serviceTypeId: spec.id,
    jobType: spec.jobType,
    keyReplacementMode: spec.keyMode,
    dispatchJobTypeLabel:
      "dispatchLabel" in spec && spec.dispatchLabel
        ? spec.dispatchLabel
        : formatIntakeJobTypeForDispatch(spec.jobType, spec.keyMode),
    baseCents: base,
    distancePremiumCents,
    keyBlankCents,
    programmingCents,
    highSecurityRiskCents,
    pricingTier: keyHardware.pricingTier,
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
