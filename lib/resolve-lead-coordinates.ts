// Server-only: resolve lat/lng from structured address, free text, or postal code.

import { geocodeAddress, pickAddressFromFields } from "@/lib/geocode"
import type { StructuredAddress } from "@/lib/structured-address"

export type ResolvedCoordinates = { lat: number; lng: number }

function validCoords(lat: unknown, lng: unknown): ResolvedCoordinates | null {
  const la = typeof lat === "number" ? lat : lat != null ? Number(lat) : NaN
  const ln = typeof lng === "number" ? lng : lng != null ? Number(lng) : NaN
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null
  if (Math.abs(la) > 90 || Math.abs(ln) > 180) return null
  // (0,0) is "Null Island" off the coast of West Africa — a failed-geocode sentinel,
  // never a real customer address. Treat it as missing so callers keep trying to geocode.
  if (la === 0 && ln === 0) return null
  return { lat: la, lng: ln }
}

/** Build a geocode query from postal code + city when full street geocode fails. */
function postalFallbackQuery(
  structured: Partial<StructuredAddress> | null,
  fields: Record<string, unknown>
): string | null {
  const postal =
    structured?.postal_code?.trim() ||
    String(fields.job_address_postal_code ?? fields.postal_code ?? "").trim()
  if (!postal || postal.length < 5) return null
  const locality =
    structured?.locality?.trim() ||
    String(fields.job_address_locality ?? fields.locality ?? "").trim()
  const admin =
    structured?.admin_area?.trim() ||
    String(fields.job_address_admin_area ?? fields.admin_area ?? "KY").trim()
  return [postal, locality, admin].filter(Boolean).join(", ")
}

/**
 * Resolve coordinates before persisting a lead — tries existing lat/lng, full address, then ZIP.
 */
export async function resolveLeadCoordinates(params: {
  structuredAddress?: Partial<StructuredAddress> | null
  extraFields?: Record<string, unknown>
}): Promise<ResolvedCoordinates | null> {
  const structured = params.structuredAddress ?? null
  const fields = params.extraFields ?? {}

  const existing = validCoords(structured?.lat, structured?.lng)
  if (existing) return existing

  const fromFields = validCoords(fields.customer_lat, fields.customer_lng)
  if (fromFields) return fromFields

  const address =
    structured?.formatted?.trim() ||
    pickAddressFromFields(fields) ||
    null
  if (address) {
    const hit = await geocodeAddress(address)
    if (hit) return hit
  }

  const postalQuery = postalFallbackQuery(structured, fields)
  if (postalQuery) {
    const hit = await geocodeAddress(postalQuery)
    if (hit) return hit
  }

  return null
}
