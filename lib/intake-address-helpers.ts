// Helpers for answered-call intake — flat CRM address → map-ready structured address.

import {
  isCompleteStructuredAddress,
  type StructuredAddress,
} from "@/lib/structured-address"

type AddressSuggestion = StructuredAddress & { place_id?: string | null; label?: string }

/** Build a geocode search string from saved customer address fields. */
export function buildFlatAddressQuery(parts: {
  addressLine1: string
  addressLine2?: string
  city: string
  region?: string
  postalCode: string
}): string | null {
  const line1 = parts.addressLine1.trim()
  const city = parts.city.trim()
  const postal = parts.postalCode.trim()
  if (!line1 || !city || !postal) return null
  const chunks = [line1, parts.addressLine2?.trim(), city, parts.region?.trim(), postal].filter(Boolean)
  return chunks.join(", ")
}

/** What still blocks the Send to dispatch map button (shown under the footer). */
export function listIntakeDispatchBlockers(input: {
  displayName: string
  serviceAddress: StructuredAddress | null
  jobType: string
  keyReplacementMode: string
}): string[] {
  const blockers: string[] = []
  if (!input.displayName.trim()) blockers.push("Caller name")
  if (!input.serviceAddress || !isCompleteStructuredAddress(input.serviceAddress)) {
    blockers.push("Service address — pick a suggestion or wait for saved address to verify")
  }
  if (input.jobType === "Key replacement" && !input.keyReplacementMode.trim()) {
    blockers.push("Key replacement type (origination or duplication)")
  } else if (!input.jobType.trim()) {
    blockers.push("Service type")
  }
  return blockers
}

/** Resolve the best structured address for a free-text query (autocomplete + place details). */
export async function resolveStructuredAddressFromQuery(query: string): Promise<StructuredAddress | null> {
  const trimmed = query.trim()
  if (trimmed.length < 5) return null

  const res = await fetch(`/api/geocode/autocomplete?q=${encodeURIComponent(trimmed)}`, {
    credentials: "include",
    cache: "no-store",
  })
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
  })
  if (!detailRes.ok) return null

  const detailJson = (await detailRes.json()) as { data?: { address?: StructuredAddress } }
  const addr = detailJson.data?.address
  return addr && isCompleteStructuredAddress(addr) ? addr : null
}
