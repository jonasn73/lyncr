// Spread map pins that share the same coordinates so stacked jobs remain visible.

/** Improve geocode query when hopper jobs only have a ZIP. */
function geocodeQueryForPoolLocation(location: string | null | undefined): string | null {
  const raw = location?.trim()
  if (!raw) return null
  if (/^\d{5}(-\d{4})?$/.test(raw)) return `${raw}, Louisville, KY`
  if (raw.length <= 6 && /^\d+$/.test(raw)) return `${raw}, Louisville, KY`
  // "Kentucky 40217" / "Louisville KY 40217" — pull the ZIP and bias to Louisville.
  const embeddedZip = raw.match(/\b(\d{5})(?:-\d{4})?\b/)
  if (embeddedZip && !/\d+\s+\w+/.test(raw.split(",")[0] ?? "")) {
    // No street number in the first segment — treat as area/ZIP label.
    return `${embeddedZip[1]}, Louisville, KY`
  }
  return raw
}

/** Best geocode query for a hopper job (prefers ZIP/neighborhood label on the card). */
export function geocodeQueryForPoolJob(job: {
  location?: string | null
  neighborhood?: string | null
}): string | null {
  const neighborhood = job.neighborhood?.trim()
  const location = job.location?.trim()
  if (neighborhood && /^\d{5}/.test(neighborhood)) {
    return geocodeQueryForPoolLocation(neighborhood)
  }
  if (location) return geocodeQueryForPoolLocation(location)
  return null
}

function coordKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`
}

/** True when the job's map pin should be re-resolved from its address/ZIP. */
export function poolJobNeedsGeocode(
  job: { latitude?: number | null; longitude?: number | null; location?: string | null; neighborhood?: string | null },
  duplicateCoords: boolean
): boolean {
  if (job.latitude == null || job.longitude == null) return true
  if (duplicateCoords) return true
  const area = job.neighborhood?.trim() || job.location?.trim() || ""
  return /^\d{5}(-\d{4})?$/.test(area) || (area.length <= 6 && /^\d+$/.test(area))
}

export { coordKey as poolCoordKey }
