// ============================================
// Address → coordinates (geocoding)
// ============================================
// Client-safe module — no database imports.

import { isCompleteStructuredAddress, type StructuredAddress } from "@/lib/structured-address"

export interface GeoPoint {
  lat: number
  lng: number
}

/** Pull the most address-like value out of an operator's captured job fields. */
export function pickAddressFromFields(fields: Record<string, unknown>): string | null {
  const keys = ["job_address_full", "job_address", "service_address", "address", "location", "address_line1", "street_address"]
  for (const k of keys) {
    const v = fields[k]
    if (typeof v === "string" && v.trim().length >= 5) return v.trim()
  }
  return null
}

/** Try to rebuild a validated structured address from collected intake fields. */
export function structuredAddressFromCollected(fields: Record<string, unknown>): StructuredAddress | null {
  const formatted = String(fields.job_address_full ?? fields.job_address ?? "").trim()
  const street_number = String(fields.job_address_street_number ?? "").trim()
  const route = String(fields.job_address_route ?? "").trim()
  const locality = String(fields.job_address_locality ?? "").trim()
  const postal_code = String(fields.job_address_postal_code ?? "").trim()
  const admin_area = String(fields.job_address_admin_area ?? "").trim()
  const latRaw = fields.customer_lat
  const lngRaw = fields.customer_lng
  const lat = typeof latRaw === "number" ? latRaw : latRaw != null ? Number(latRaw) : null
  const lng = typeof lngRaw === "number" ? lngRaw : lngRaw != null ? Number(lngRaw) : null
  const candidate = {
    formatted,
    street_number,
    route,
    locality,
    postal_code,
    admin_area,
    lat: lat != null && Number.isFinite(lat) ? lat : null,
    lng: lng != null && Number.isFinite(lng) ? lng : null,
  }
  return isCompleteStructuredAddress(candidate) ? candidate : null
}

function googleKey(): string | null {
  return (
    process.env.GOOGLE_GEOCODING_API_KEY?.trim() ||
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    null
  )
}

async function geocodeWithGoogle(address: string, key: string): Promise<GeoPoint | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) return null
  const data = (await res.json()) as {
    status?: string
    results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }>
  }
  const loc = data.results?.[0]?.geometry?.location
  if (data.status !== "OK" || !loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") return null
  return { lat: loc.lat, lng: loc.lng }
}

async function geocodeWithNominatim(address: string): Promise<GeoPoint | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "lyncr/1.0 (dispatch geofence; support@getzingapp.com)" },
  })
  if (!res.ok) return null
  const data = (await res.json()) as Array<{ lat?: string; lon?: string }>
  const hit = data?.[0]
  if (!hit?.lat || !hit?.lon) return null
  const lat = Number(hit.lat)
  const lng = Number(hit.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

/** Geocode a free-text address to coordinates, or null if it can't be resolved. */
export async function geocodeAddress(address: string): Promise<GeoPoint | null> {
  const trimmed = address?.trim()
  if (!trimmed || trimmed.length < 5) return null
  try {
    const key = googleKey()
    const point = key ? await geocodeWithGoogle(trimmed, key) : await geocodeWithNominatim(trimmed)
    if (!point) return null
    if (Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) return null
    return point
  } catch (e) {
    console.error("[geocode] failed for address:", e)
    return null
  }
}
