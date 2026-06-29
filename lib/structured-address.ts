// Structured job-site address — validated components for geocoding + map precision.

export type StructuredAddress = {
  /** Full formatted line shown in UI. */
  formatted: string
  street_number: string
  route: string
  locality: string
  postal_code: string
  admin_area: string
  lat: number | null
  lng: number | null
}

export type AddressSuggestion = StructuredAddress & {
  place_id?: string | null
  /** Google prediction text before place-details resolves structured fields. */
  label?: string
}

/** True when a dropdown row can be shown (complete address or Google place_id to resolve). */
export function isSelectableAddressSuggestion(
  addr: Partial<AddressSuggestion> | null | undefined
): boolean {
  if (!addr) return false
  if (isCompleteStructuredAddress(addr)) return true
  return Boolean(addr.place_id?.trim() && (addr.label?.trim() || addr.formatted?.trim()))
}

/** Required components for a map-ready service address. */
export function isCompleteStructuredAddress(addr: Partial<StructuredAddress> | null | undefined): addr is StructuredAddress {
  if (!addr?.formatted?.trim()) return false
  if (!String(addr.street_number ?? "").trim()) return false
  if (!String(addr.route ?? "").trim()) return false
  if (!String(addr.locality ?? "").trim()) return false
  if (!String(addr.postal_code ?? "").trim()) return false
  return true
}

export function structuredAddressValidationError(addr: Partial<StructuredAddress> | null | undefined): string | null {
  if (!addr?.formatted?.trim()) return "Select a complete street address from the suggestions."
  if (!String(addr.street_number ?? "").trim()) return "Address must include a street number."
  if (!String(addr.route ?? "").trim()) return "Address must include a street name."
  if (!String(addr.locality ?? "").trim()) return "Address must include a city."
  if (!String(addr.postal_code ?? "").trim()) return "Address must include a ZIP / postal code."
  return null
}

/** Flatten structured address into ai_leads.collected keys. */
export function structuredAddressToCollected(addr: StructuredAddress): Record<string, string | number | null> {
  return {
    job_address: addr.formatted,
    location: addr.formatted,
    service_address: addr.formatted,
    job_address_full: addr.formatted,
    job_address_street_number: addr.street_number,
    job_address_route: addr.route,
    job_address_locality: addr.locality,
    job_address_postal_code: addr.postal_code,
    job_address_admin_area: addr.admin_area,
    ...(addr.lat != null ? { customer_lat: addr.lat } : {}),
    ...(addr.lng != null ? { customer_lng: addr.lng } : {}),
  }
}

/** Parse Nominatim addressdetails payload into our canonical shape. */
export function structuredAddressFromNominatim(hit: {
  display_name?: string
  lat?: string
  lon?: string
  address?: Record<string, string>
}): AddressSuggestion {
  const a = hit.address ?? {}
  const streetNumber = a.house_number ?? a.house_name ?? ""
  const route = a.road ?? a.pedestrian ?? a.footway ?? ""
  const locality = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality ?? ""
  const postal = a.postcode ?? ""
  const admin = a.state ?? a.region ?? ""
  const formatted = hit.display_name ?? [streetNumber, route, locality, admin, postal].filter(Boolean).join(", ")
  return {
    formatted,
    street_number: streetNumber,
    route,
    locality,
    postal_code: postal,
    admin_area: admin,
    lat: hit.lat ? Number(hit.lat) : null,
    lng: hit.lon ? Number(hit.lon) : null,
    place_id: null,
  }
}

/** Parse Photon (Komoot / OSM) feature into our canonical shape. */
export function structuredAddressFromPhoton(feature: {
  geometry?: { coordinates?: [number, number] }
  properties?: {
    housenumber?: string
    street?: string
    city?: string
    state?: string
    postcode?: string
    county?: string
    country?: string
    name?: string
  }
}): AddressSuggestion {
  const p = feature.properties ?? {}
  const streetNumber = String(p.housenumber ?? "").trim()
  const route = String(p.street ?? p.name ?? "").trim()
  const locality = String(p.city ?? "").trim()
  const postal = String(p.postcode ?? "").trim()
  const admin = String(p.state ?? "").trim()
  const coords = feature.geometry?.coordinates
  const formatted = [streetNumber, route, locality, admin, postal].filter(Boolean).join(", ")
  return {
    formatted: formatted || [streetNumber, route].filter(Boolean).join(" "),
    street_number: streetNumber,
    route,
    locality,
    postal_code: postal,
    admin_area: admin,
    lat: coords && Number.isFinite(coords[1]) ? coords[1] : null,
    lng: coords && Number.isFinite(coords[0]) ? coords[0] : null,
    place_id: null,
  }
}

/** Parse Google Geocoding address_components into our canonical shape. */
export function structuredAddressFromGoogle(result: {
  formatted_address?: string
  geometry?: { location?: { lat?: number; lng?: number } }
  address_components?: Array<{ long_name?: string; short_name?: string; types?: string[] }>
}): AddressSuggestion {
  const comps = result.address_components ?? []
  const pick = (...types: string[]) => {
    for (const t of types) {
      const c = comps.find((x) => x.types?.includes(t))
      if (c?.long_name) return c.long_name
    }
    return ""
  }
  const streetNumber = pick("street_number")
  const route = pick("route")
  const locality = pick("locality", "postal_town", "sublocality", "neighborhood")
  const postal = pick("postal_code")
  const admin = pick("administrative_area_level_1")
  const loc = result.geometry?.location
  return {
    formatted: result.formatted_address ?? "",
    street_number: streetNumber,
    route,
    locality,
    postal_code: postal,
    admin_area: admin,
    lat: typeof loc?.lat === "number" ? loc.lat : null,
    lng: typeof loc?.lng === "number" ? loc.lng : null,
    place_id: null,
  }
}
