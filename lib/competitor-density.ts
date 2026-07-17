// Geofenced competitor density — used by intake quote negotiation to suggest
// more aggressive floors in zip codes flooded with low-ball locksmith ads.

export type CompetitorDensity = "high" | "standard"

/** Suggested service-base floor (dollars) when pitching firm quotes in high zones. */
export const HIGH_COMPETITION_BASE_FLOOR_DOLLARS = 75

/**
 * ZIPs with heavy cheap-locksmith competition (lead-gen / low-ball markets).
 * Expand as dispatch learns which neighborhoods need aggressive quoting.
 */
const HIGH_COMPETITION_ZIP_CODES = new Set([
  // Louisville / Jefferson County — high lead-gen density
  "40216",
  "40211",
  "40212",
  "40203",
  "40210",
  "40215",
  "40208",
  "40219",
  "40214",
  "40258",
  "40272",
  // Nearby / similar markets often hit by national lead mills
  "40218",
  "40213",
  "40217",
])

/** Normalize US ZIP to 5 digits (strips ZIP+4 and non-digits). */
export function normalizeZipCode(zipCode: string | null | undefined): string {
  const digits = String(zipCode ?? "").replace(/\D/g, "")
  if (digits.length < 5) return ""
  return digits.slice(0, 5)
}

/**
 * Returns competitor density for an appointment ZIP.
 * - `high` → lots of cheap locksmith competitors; suggest aggressive quoting
 * - `standard` → normal market / unknown ZIP
 */
export function getCompetitorDensity(zipCode: string | null | undefined): CompetitorDensity {
  const zip = normalizeZipCode(zipCode)
  if (!zip) return "standard"
  return HIGH_COMPETITION_ZIP_CODES.has(zip) ? "high" : "standard"
}

/**
 * Display / firm-stage service-base target for a zone.
 * High competition: min(systemBase, aggressive floor) so we never *raise* the quote.
 */
export function competitiveBaseTargetDollars(
  systemBaseDollars: number,
  zipCode: string | null | undefined
): number {
  const system = Math.max(0, Math.round(systemBaseDollars))
  if (getCompetitorDensity(zipCode) !== "high") return system
  return Math.min(system, HIGH_COMPETITION_BASE_FLOOR_DOLLARS)
}
