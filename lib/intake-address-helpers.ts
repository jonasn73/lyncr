// Helpers for answered-call intake — flat CRM address → map-ready structured address.

import { DEFAULT_502_SERVICE_BIAS } from "@/lib/geocode-service-bias"
import {
  isCompleteStructuredAddress,
  type StructuredAddress,
} from "@/lib/structured-address"

type AddressSuggestion = StructuredAddress & { place_id?: string | null; label?: string }

/**
 * Book forms often store one line (“1079 Cherokee rd 40204”) without a separate city.
 * A street with a number (or ZIP) is enough to continue booking — geocode can refine later.
 */
export function isSubstantialStreetAddress(line1: string): boolean {
  const t = line1.trim()
  if (t.length < 8) return false
  return /\d/.test(t)
}

/** Street + city, or a substantial single-line book-form address. */
export function isFlatAddressReadyForDispatch(parts: { addressLine1: string; city: string }): boolean {
  const line1 = parts.addressLine1.trim()
  const city = parts.city.trim()
  if (line1 && city) return true
  return isSubstantialStreetAddress(line1)
}

/** Structured autocomplete pick OR saved CRM / book-form street. */
export function isIntakeAddressReady(input: {
  serviceAddress: StructuredAddress | null
  addressLine1: string
  city: string
}): boolean {
  if (input.serviceAddress && isCompleteStructuredAddress(input.serviceAddress)) return true
  return isFlatAddressReadyForDispatch(input)
}

/** Build a geocode search string from saved customer address fields. */
export function buildFlatAddressQuery(parts: {
  addressLine1: string
  addressLine2?: string
  city: string
  region?: string
  postalCode?: string
}): string | null {
  const line1 = parts.addressLine1.trim()
  if (!line1) return null
  const city = parts.city.trim()
  // Book-form single lines: still seed the Location box even when city is blank.
  if (!city) {
    const zip = parts.postalCode?.trim()
    return zip ? `${line1}, ${zip}` : line1
  }
  const chunks = [line1, parts.addressLine2?.trim(), city, parts.region?.trim(), parts.postalCode?.trim()].filter(
    Boolean
  )
  return chunks.join(", ")
}

/** What still blocks the Send to dispatch map button (shown under the footer). */
export function listIntakeDispatchBlockers(input: {
  displayName: string
  serviceAddress: StructuredAddress | null
  addressLine1: string
  city: string
}): string[] {
  const blockers: string[] = []
  if (!input.displayName.trim()) blockers.push("Caller name")
  if (!isIntakeAddressReady(input)) {
    blockers.push("Service address (street + city, or pick a suggestion)")
  }
  return blockers
}

/** Resolve the best structured address for a free-text query (autocomplete + place details). */
export async function resolveStructuredAddressFromQuery(
  query: string,
  opts?: { signal?: AbortSignal }
): Promise<StructuredAddress | null> {
  const trimmed = query.trim()
  if (trimmed.length < 5) return null

  try {
    const res = await fetch(
      `/api/geocode/autocomplete?q=${encodeURIComponent(trimmed)}` +
        `&lat=${DEFAULT_502_SERVICE_BIAS.lat}&lon=${DEFAULT_502_SERVICE_BIAS.lon}`,
      {
        credentials: "include",
        cache: "no-store",
        signal: opts?.signal,
      }
    )
    if (!res.ok) return null

    const json = (await res.json()) as { data?: { suggestions?: AddressSuggestion[] } }
    const suggestions = Array.isArray(json.data?.suggestions) ? json.data!.suggestions! : []

    for (const s of suggestions) {
      if (isCompleteStructuredAddress(s)) return s
    }

    const placeId = suggestions.find((s) => s.place_id?.trim())?.place_id?.trim()
    if (!placeId) return null

    const detailRes = await fetch(`/api/geocode/place-details?place_id=${encodeURIComponent(placeId)}`, {
      credentials: "include",
      cache: "no-store",
      signal: opts?.signal,
    })
    if (!detailRes.ok) return null

    const detailJson = (await detailRes.json()) as { data?: { address?: StructuredAddress } }
    const addr = detailJson.data?.address
    return addr && isCompleteStructuredAddress(addr) ? addr : null
  } catch (err: unknown) {
    // Caller aborted (new keystroke / unmount) — treat as no result.
    if (
      (err instanceof DOMException && err.name === "AbortError") ||
      (typeof err === "object" &&
        err !== null &&
        "name" in err &&
        (err as { name: string }).name === "AbortError")
    ) {
      return null
    }
    throw err
  }
}

/**
 * Best-effort parse when the user typed/pasted an address without picking a suggestion.
 * Handles comma-separated lines and single-line book forms with city / state / ZIP at the end.
 */
export function parseLooseAddressQuery(raw: string): {
  addressLine1: string
  city: string
  region: string
  postalCode: string
} {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { addressLine1: "", city: "", region: "", postalCode: "" }
  }

  const segments = trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  // Comma-separated: "123 Main St, Louisville, KY 40205"
  if (segments.length >= 2) {
    const addressLine1 = segments[0] ?? trimmed
    let city = segments[1] ?? ""
    let region = ""
    let postalCode = ""
    if (segments.length >= 3) {
      const tail = segments.slice(2).join(" ")
      const zipMatch = tail.match(/\b(\d{5})(?:-\d{4})?\b/)
      if (zipMatch) postalCode = zipMatch[1]!
      const stateMatch = tail.match(/\b([A-Za-z]{2})\b/)
      if (stateMatch) region = stateMatch[1]!.toUpperCase()
    } else {
      // "123 Main, Louisville KY 40205" — city segment may include state/zip.
      const zipMatch = city.match(/\b(\d{5})(?:-\d{4})?\b/)
      if (zipMatch) {
        postalCode = zipMatch[1]!
        city = city.replace(zipMatch[0], "").trim()
      }
      const stateMatch = city.match(/\b([A-Za-z]{2})\b\s*$/)
      if (stateMatch) {
        region = stateMatch[1]!.toUpperCase()
        city = city.replace(stateMatch[0], "").trim()
      }
    }
    return { addressLine1, city, region, postalCode }
  }

  // Single line: "2440 Bardstown rd Louisville KY 40205" or "1079 Cherokee rd 40204"
  const zipMatch = trimmed.match(/\b(\d{5})(?:-\d{4})?\b/)
  const postalCode = zipMatch?.[1] ?? ""
  let withoutZip = zipMatch ? trimmed.replace(zipMatch[0], "").replace(/\s+/g, " ").trim() : trimmed
  const stateMatch = withoutZip.match(/\b([A-Za-z]{2})\b\s*$/)
  let region = ""
  if (stateMatch) {
    region = stateMatch[1]!.toUpperCase()
    withoutZip = withoutZip.replace(stateMatch[0], "").replace(/\s+/g, " ").trim()
  }
  // Last word after street number + street name is often the city (when state/zip were present).
  let city = ""
  let addressLine1 = withoutZip
  if (region || postalCode) {
    const tokens = withoutZip.split(/\s+/).filter(Boolean)
    if (tokens.length >= 3) {
      city = tokens[tokens.length - 1]!
      addressLine1 = tokens.slice(0, -1).join(" ")
    }
  }
  return { addressLine1, city, region, postalCode }
}
