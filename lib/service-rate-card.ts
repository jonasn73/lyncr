// Owner-configurable service quote rate profiles (from onboarding_profiles.service_rules JSON).

import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { neon } from "@neondatabase/serverless"

export type ServiceQuoteTypeId =
  | "lockout"
  | "key_generation"
  | "key_duplication"
  | "programming_diagnostics"
  | "ignition_repair"
  | "key_extraction"
  | "rekey"
  | "lock_installation"
  | "commercial_hardware"
  | "other"

/** Every service id shown in the intake quote calculator dropdown. */
export const SERVICE_QUOTE_TYPE_IDS: ServiceQuoteTypeId[] = [
  "lockout",
  "key_generation",
  "key_duplication",
  "programming_diagnostics",
  "ignition_repair",
  "key_extraction",
  "rekey",
  "lock_installation",
  "commercial_hardware",
  "other",
]

/** Map legacy calculator ids stored on older leads / rate cards. */
const LEGACY_SERVICE_QUOTE_TYPE_IDS: Record<string, ServiceQuoteTypeId> = {
  key_gen: "key_generation",
  key_dup: "key_duplication",
  ignition: "ignition_repair",
}

/** Normalize stored service_quote_type_id values to the current enum. */
export function normalizeServiceQuoteTypeId(raw: string | null | undefined): ServiceQuoteTypeId {
  const id = raw?.trim() ?? ""
  if (!id) return "lockout"
  if (LEGACY_SERVICE_QUOTE_TYPE_IDS[id]) return LEGACY_SERVICE_QUOTE_TYPE_IDS[id]
  if ((SERVICE_QUOTE_TYPE_IDS as string[]).includes(id)) return id as ServiceQuoteTypeId
  return "other"
}

/** One line item in a stored pricing_metadata breakdown. */
export type PricingMetadataLine = {
  kind: "base_rate" | "vehicle_age_tier" | "premium_brand" | "distance_travel" | "key_blank" | "key_programming"
  label: string
  cents: number
}

/** Snapshot persisted on ai_leads.collected.pricing_metadata at booking time. */
export type IntakePricingMetadata = {
  version: 1
  quoted_price_cents: number
  service_type_id: ServiceQuoteTypeId
  dispatch_job_type_label: string
  vehicle_year: string | null
  vehicle_make: string | null
  vehicle_model: string | null
  lines: PricingMetadataLine[]
  rate_card_source: "onboarding_profiles.service_rules" | "default"
  computed_at: string
}

/** Vehicle age surcharge tier (years old → extra cents). */
export type ServiceRateVehicleAgeTier = {
  min_age_years: number
  cents: number
  label?: string
}

/**
 * Structured rate profile used by lib/service-quote-calculator.ts.
 * Owners can store JSON in onboarding_profiles.service_rules:
 *
 * {
 *   "rate_card": {
 *     "version": 1,
 *     "services": { "lockout": 8500, "key_generation": 17500, "key_duplication": 9500, "ignition_repair": 22000, "other": 12000 },
 *     "vehicle_age_tiers": [
 *       { "min_age_years": 12, "cents": 1500, "label": "Vehicle age adjustment" },
 *       { "min_age_years": 20, "cents": 3500, "label": "Older vehicle adjustment" }
 *     ],
 *     "premium_makes": ["BMW", "Mercedes-Benz", "Tesla"],
 *     "premium_make_cents": 2500,
 *     "premium_make_label": "Premium make adjustment",
 *     "distance_included_miles": 10,
 *     "distance_per_mile_cents": 200,
 *     "distance_label": "Travel distance"
 *   }
 * }
 *
 * Plain-text service_rules (no JSON) still works for operator briefing — quotes fall back to defaults.
 */
export type ServiceRateCard = {
  version: 1
  services: Record<ServiceQuoteTypeId, number>
  vehicle_age_tiers: ServiceRateVehicleAgeTier[]
  premium_makes: string[]
  premium_make_cents: number
  premium_make_label: string
  vehicle_age_default_label: string
  /** Miles included before per-mile travel surcharge applies. */
  distance_included_miles: number
  /** Cents charged per mile beyond distance_included_miles. */
  distance_per_mile_cents: number
  distance_label: string
  /** Smart / prox fob blank part cost (cents). */
  key_blank_smart_cents: number
  /** High-security / remote-head blank part cost (cents). */
  key_blank_high_security_cents: number
  /** OBD programming fee when a transponder or smart key is involved (cents). */
  key_programming_cents: number
  key_blank_label: string
  key_programming_label: string
}

export const DEFAULT_SERVICE_RATE_CARD: ServiceRateCard = {
  version: 1,
  services: {
    lockout: 8500,
    key_generation: 17500,
    key_duplication: 9500,
    programming_diagnostics: 15000,
    ignition_repair: 22000,
    key_extraction: 12000,
    rekey: 14000,
    lock_installation: 16000,
    commercial_hardware: 18000,
    other: 12000,
  },
  vehicle_age_tiers: [
    { min_age_years: 20, cents: 3500, label: "Vehicle age adjustment" },
    { min_age_years: 12, cents: 1500, label: "Vehicle age adjustment" },
  ],
  premium_makes: [
    "Acura",
    "Audi",
    "BMW",
    "Cadillac",
    "Genesis",
    "Infiniti",
    "Jaguar",
    "Land Rover",
    "Lexus",
    "Lincoln",
    "Mercedes-Benz",
    "Mercedes",
    "Porsche",
    "Tesla",
    "Volvo",
  ],
  premium_make_cents: 2500,
  premium_make_label: "Premium make adjustment",
  vehicle_age_default_label: "Vehicle age adjustment",
  distance_included_miles: 0,
  distance_per_mile_cents: 350,
  distance_label: "Travel distance",
  key_blank_smart_cents: 6000,
  key_blank_high_security_cents: 2000,
  key_programming_cents: 4500,
  key_blank_label: "Key blank / fob part",
  key_programming_label: "OBD programming",
}

let cachedSql: ReturnType<typeof neon> | null = null

function getSql(): ReturnType<typeof neon> {
  if (cachedSql) return cachedSql
  cachedSql = neon(resolveNeonDatabaseUrl())
  return cachedSql
}

function pgErrorCode(e: unknown): string | undefined {
  if (e && typeof e === "object" && "code" in e) return String((e as { code: unknown }).code)
  return undefined
}

function isMissingOnboardingProfilesTableError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.includes('relation "onboarding_profiles" does not exist')
}

function coerceServiceCents(raw: unknown, fallback: number): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.round(n)
}

function normalizeAgeTiers(raw: unknown): ServiceRateVehicleAgeTier[] {
  if (!Array.isArray(raw)) return DEFAULT_SERVICE_RATE_CARD.vehicle_age_tiers
  const tiers: ServiceRateVehicleAgeTier[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const minAge = Number(row.min_age_years)
    const cents = Number(row.cents)
    if (!Number.isFinite(minAge) || minAge < 0 || !Number.isFinite(cents) || cents < 0) continue
    tiers.push({
      min_age_years: Math.floor(minAge),
      cents: Math.round(cents),
      label: typeof row.label === "string" ? row.label.trim() : undefined,
    })
  }
  return tiers.length > 0
    ? tiers.sort((a, b) => b.min_age_years - a.min_age_years)
    : DEFAULT_SERVICE_RATE_CARD.vehicle_age_tiers
}

function normalizePremiumMakes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return DEFAULT_SERVICE_RATE_CARD.premium_makes
  const makes = raw.map((m) => String(m).trim()).filter(Boolean)
  return makes.length > 0 ? makes : DEFAULT_SERVICE_RATE_CARD.premium_makes
}

/** Merge a partial profile onto platform defaults (missing keys inherit defaults). */
export function resolveServiceRateCard(rateCard?: Partial<ServiceRateCard> | null): ServiceRateCard {
  if (!rateCard) return DEFAULT_SERVICE_RATE_CARD
  const services = { ...DEFAULT_SERVICE_RATE_CARD.services, ...(rateCard.services ?? {}) }
  return {
    version: 1,
    services,
    vehicle_age_tiers: rateCard.vehicle_age_tiers?.length
      ? normalizeAgeTiers(rateCard.vehicle_age_tiers)
      : DEFAULT_SERVICE_RATE_CARD.vehicle_age_tiers,
    premium_makes: rateCard.premium_makes?.length
      ? normalizePremiumMakes(rateCard.premium_makes)
      : DEFAULT_SERVICE_RATE_CARD.premium_makes,
    premium_make_cents:
      rateCard.premium_make_cents != null && rateCard.premium_make_cents >= 0
        ? Math.round(rateCard.premium_make_cents)
        : DEFAULT_SERVICE_RATE_CARD.premium_make_cents,
    premium_make_label: rateCard.premium_make_label?.trim() || DEFAULT_SERVICE_RATE_CARD.premium_make_label,
    vehicle_age_default_label:
      rateCard.vehicle_age_default_label?.trim() || DEFAULT_SERVICE_RATE_CARD.vehicle_age_default_label,
    distance_included_miles:
      rateCard.distance_included_miles != null && rateCard.distance_included_miles >= 0
        ? rateCard.distance_included_miles
        : DEFAULT_SERVICE_RATE_CARD.distance_included_miles,
    distance_per_mile_cents:
      rateCard.distance_per_mile_cents != null && rateCard.distance_per_mile_cents >= 0
        ? Math.round(rateCard.distance_per_mile_cents)
        : DEFAULT_SERVICE_RATE_CARD.distance_per_mile_cents,
    distance_label: rateCard.distance_label?.trim() || DEFAULT_SERVICE_RATE_CARD.distance_label,
    key_blank_smart_cents:
      rateCard.key_blank_smart_cents != null && rateCard.key_blank_smart_cents >= 0
        ? Math.round(rateCard.key_blank_smart_cents)
        : DEFAULT_SERVICE_RATE_CARD.key_blank_smart_cents,
    key_blank_high_security_cents:
      rateCard.key_blank_high_security_cents != null && rateCard.key_blank_high_security_cents >= 0
        ? Math.round(rateCard.key_blank_high_security_cents)
        : DEFAULT_SERVICE_RATE_CARD.key_blank_high_security_cents,
    key_programming_cents:
      rateCard.key_programming_cents != null && rateCard.key_programming_cents >= 0
        ? Math.round(rateCard.key_programming_cents)
        : DEFAULT_SERVICE_RATE_CARD.key_programming_cents,
    key_blank_label: rateCard.key_blank_label?.trim() || DEFAULT_SERVICE_RATE_CARD.key_blank_label,
    key_programming_label:
      rateCard.key_programming_label?.trim() || DEFAULT_SERVICE_RATE_CARD.key_programming_label,
  }
}

/** Parse structured JSON from onboarding_profiles.service_rules (null → defaults). */
export function parseServiceRateCardFromRules(raw: string | null | undefined): {
  rateCard: ServiceRateCard
  source: "onboarding_profiles.service_rules" | "default"
} {
  const text = raw?.trim()
  if (!text) return { rateCard: DEFAULT_SERVICE_RATE_CARD, source: "default" }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { rateCard: DEFAULT_SERVICE_RATE_CARD, source: "default" }
  }

  if (!parsed || typeof parsed !== "object") {
    return { rateCard: DEFAULT_SERVICE_RATE_CARD, source: "default" }
  }

  const root = parsed as Record<string, unknown>
  const cardRaw = (root.rate_card ?? root.rateCard ?? root) as Record<string, unknown>
  if (!cardRaw || typeof cardRaw !== "object") {
    return { rateCard: DEFAULT_SERVICE_RATE_CARD, source: "default" }
  }

  const servicesRaw = (cardRaw.services ?? cardRaw.base_rates) as Record<string, unknown> | undefined
  const services: Partial<Record<ServiceQuoteTypeId, number>> = {}
  if (servicesRaw && typeof servicesRaw === "object") {
    for (const [rawKey, rawCents] of Object.entries(servicesRaw)) {
      const key = normalizeServiceQuoteTypeId(rawKey)
      services[key] = coerceServiceCents(rawCents, DEFAULT_SERVICE_RATE_CARD.services[key])
    }
  }

  const hasCustom =
    Object.keys(services).length > 0 ||
    cardRaw.vehicle_age_tiers != null ||
    cardRaw.premium_makes != null ||
    cardRaw.premium_make_cents != null ||
    cardRaw.distance_included_miles != null ||
    cardRaw.distance_per_mile_cents != null

  if (!hasCustom) {
    return { rateCard: DEFAULT_SERVICE_RATE_CARD, source: "default" }
  }

  return {
    rateCard: resolveServiceRateCard({
      services: services as ServiceRateCard["services"],
      vehicle_age_tiers: normalizeAgeTiers(cardRaw.vehicle_age_tiers),
      premium_makes: normalizePremiumMakes(cardRaw.premium_makes),
      premium_make_cents: coerceServiceCents(
        cardRaw.premium_make_cents,
        DEFAULT_SERVICE_RATE_CARD.premium_make_cents
      ),
      premium_make_label:
        typeof cardRaw.premium_make_label === "string" ? cardRaw.premium_make_label : undefined,
      vehicle_age_default_label:
        typeof cardRaw.vehicle_age_default_label === "string"
          ? cardRaw.vehicle_age_default_label
          : undefined,
      distance_included_miles:
        cardRaw.distance_included_miles != null
          ? Number(cardRaw.distance_included_miles)
          : undefined,
      distance_per_mile_cents:
        cardRaw.distance_per_mile_cents != null
          ? Number(cardRaw.distance_per_mile_cents)
          : undefined,
      distance_label: typeof cardRaw.distance_label === "string" ? cardRaw.distance_label : undefined,
    }),
    source: "onboarding_profiles.service_rules",
  }
}

/** Load owner rate profile from Neon (defensive when column/table missing). */
export async function getOwnerServiceRateCard(ownerUserId: string): Promise<{
  rateCard: ServiceRateCard
  source: "onboarding_profiles.service_rules" | "default"
}> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT service_rules FROM onboarding_profiles WHERE user_id = ${ownerUserId} LIMIT 1
    `
    const raw = rows[0] as { service_rules?: unknown } | undefined
    const text = raw?.service_rules != null ? String(raw.service_rules) : null
    return parseServiceRateCardFromRules(text)
  } catch (e) {
    if (pgErrorCode(e) === "42703" || isMissingOnboardingProfilesTableError(e)) {
      return { rateCard: DEFAULT_SERVICE_RATE_CARD, source: "default" }
    }
    throw e
  }
}

/** Build the historical pricing_metadata blob stored on ai_leads.collected. */
export function buildIntakePricingMetadata(params: {
  quote: {
    serviceTypeId: ServiceQuoteTypeId
    dispatchJobTypeLabel: string
    totalCents: number
    lines: { label: string; cents: number; kind?: PricingMetadataLine["kind"] }[]
  }
  vehicleYear?: string | null
  vehicleMake?: string | null
  vehicleModel?: string | null
  rateCardSource: "onboarding_profiles.service_rules" | "default"
}): IntakePricingMetadata {
  return {
    version: 1,
    quoted_price_cents: params.quote.totalCents,
    service_type_id: params.quote.serviceTypeId,
    dispatch_job_type_label: params.quote.dispatchJobTypeLabel,
    vehicle_year: params.vehicleYear?.trim() || null,
    vehicle_make: params.vehicleMake?.trim() || null,
    vehicle_model: params.vehicleModel?.trim() || null,
    lines: params.quote.lines.map((line, index) => ({
      kind:
        line.kind ??
        (index === 0
          ? "base_rate"
          : line.kind ??
            (line.label.toLowerCase().includes("travel") || line.label.toLowerCase().includes("distance")
              ? "distance_travel"
              : line.label.toLowerCase().includes("premium")
                ? "premium_brand"
                : "vehicle_age_tier")),
      label: line.label,
      cents: line.cents,
    })),
    rate_card_source: params.rateCardSource,
    computed_at: new Date().toISOString(),
  }
}
