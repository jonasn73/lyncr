// GET /api/geocode/autocomplete?q=123+Main+St
// Returns structured address suggestions (Google Places, Photon OSM, or Nominatim).

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { resolveGeocodeServiceBias } from "@/lib/geocode-service-bias"
import {
  addressQueryTokens,
  isCompleteStructuredAddress,
  isSelectableAddressSuggestion,
  structuredAddressFromGoogle,
  structuredAddressFromNominatim,
  structuredAddressFromPhoton,
  synthesizeAddressFromQuery,
  type AddressSuggestion,
} from "@/lib/structured-address"

function googleKey(): string | null {
  return (
    process.env.GOOGLE_GEOCODING_API_KEY?.trim() ||
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    null
  )
}

/** Fast Google predictions — structured fields resolved when user picks (place-details). */
async function suggestWithGoogle(
  query: string,
  key: string,
  bias: { lat: number; lon: number }
): Promise<AddressSuggestion[]> {
  const autoUrl =
    `https://maps.googleapis.com/maps/api/place/autocomplete/json` +
    `?input=${encodeURIComponent(query)}` +
    `&types=address` +
    `&components=country:us` +
    `&location=${bias.lat},${bias.lon}` +
    `&radius=80000` +
    `&key=${key}`
  const autoRes = await fetch(autoUrl, { cache: "no-store" })
  if (!autoRes.ok) return []
  const autoData = (await autoRes.json()) as {
    predictions?: Array<{ description?: string; place_id?: string }>
  }
  return (autoData.predictions ?? []).slice(0, 6).flatMap((p) => {
    if (!p.place_id || !p.description?.trim()) return []
    return [
      {
        formatted: p.description,
        label: p.description,
        street_number: "",
        route: "",
        locality: "",
        postal_code: "",
        admin_area: "",
        lat: null,
        lng: null,
        place_id: p.place_id,
      },
    ]
  })
}

type PhotonFeature = Parameters<typeof structuredAddressFromPhoton>[0] & {
  properties?: { countrycode?: string }
}

/** Photon (Komoot) — strong US partial-address matching without an API key. */
async function suggestWithPhoton(
  query: string,
  bias: { lat: number; lon: number }
): Promise<AddressSuggestion[]> {
  const url =
    `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}` +
    `&limit=12&lang=en&lat=${bias.lat}&lon=${bias.lon}`
  const res = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  })
  if (!res.ok) return []
  const data = (await res.json()) as { features?: PhotonFeature[] }
  const out: AddressSuggestion[] = []
  for (const feature of data.features ?? []) {
    const countryCode = String(feature.properties?.countrycode ?? "US").toUpperCase()
    if (countryCode && countryCode !== "US") continue
    const addr = structuredAddressFromPhoton(feature)
    if (isCompleteStructuredAddress(addr)) {
      out.push(addr)
      continue
    }
    const synthesized = synthesizeAddressFromQuery(query, addr)
    if (synthesized && isCompleteStructuredAddress(synthesized)) {
      out.push(synthesized)
    }
  }
  return out
}

async function suggestWithNominatim(
  query: string,
  bias: { lat: number; lon: number }
): Promise<AddressSuggestion[]> {
  const url =
    `https://nominatim.openstreetmap.org/search?format=json&limit=8&addressdetails=1` +
    `&countrycodes=us&viewbox=${bias.lon - 1.2},${bias.lat + 0.8},${bias.lon + 1.2},${bias.lat - 0.8}` +
    `&bounded=0&q=${encodeURIComponent(query)}`
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "lyncr/1.0 (address autocomplete; support@lyncr.app)" },
  })
  if (!res.ok) return []
  const data = (await res.json()) as Array<{
    display_name?: string
    lat?: string
    lon?: string
    address?: Record<string, string>
  }>
  return data
    .map((hit) => structuredAddressFromNominatim(hit))
    .filter((addr) => isCompleteStructuredAddress(addr))
}

function mergeSuggestions(lists: AddressSuggestion[][], query: string): AddressSuggestion[] {
  const seen = new Set<string>()
  const merged: AddressSuggestion[] = []
  for (const list of lists) {
    for (const s of list) {
      const key = s.place_id?.trim() || s.formatted.trim().toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      merged.push(s)
    }
  }
  const q = query.toLowerCase()
  const ranked = merged.sort((a, b) => scoreLocalSuggestion(b, q) - scoreLocalSuggestion(a, q))
  const bestScore = ranked[0] ? scoreLocalSuggestion(ranked[0], q) : 0
  if (bestScore >= 25) {
    return ranked.filter((s) => scoreLocalSuggestion(s, q) >= Math.max(10, bestScore - 20))
  }
  return ranked
}

/** Prefer nearby KY matches and suggestions that share words with what the user typed. */
function scoreLocalSuggestion(s: AddressSuggestion, q: string): number {
  let score = 0
  const blob = `${s.formatted} ${s.route} ${s.locality} ${s.admin_area} ${s.postal_code}`.toLowerCase()
  if (blob.includes("kentucky") || blob.includes(" ky")) score += 30
  if (blob.includes("louisville") || blob.includes("nelson") || blob.includes("jefferson")) score += 20
  if (/^40(2|1|0)/.test(String(s.postal_code))) score += 15
  if (/^\d/.test(q) && s.street_number) {
    const typed = q.trim().match(/^(\d+)/)?.[1]
    if (typed && s.street_number.startsWith(typed)) score += 25
  }
  for (const token of addressQueryTokens(q)) {
    if (blob.includes(token)) score += 18
  }
  if (blob.includes("texas") || blob.includes("winnipeg") || blob.includes("canada")) score -= 40
  return score
}

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""
  const minLen = /^\d/.test(q) ? 2 : 3
  if (q.length < minLen) {
    return NextResponse.json({ data: { suggestions: [] as AddressSuggestion[] } })
  }

  const bias = resolveGeocodeServiceBias(
    req.nextUrl.searchParams.get("lat"),
    req.nextUrl.searchParams.get("lon")
  )

  try {
    const key = googleKey()
    const [googleResults, photonResults, nominatimResults] = await Promise.all([
      key ? suggestWithGoogle(q, key, bias) : Promise.resolve([]),
      suggestWithPhoton(q, bias),
      suggestWithNominatim(q, bias),
    ])
    let suggestions = mergeSuggestions([photonResults, googleResults, nominatimResults], q)
    suggestions = suggestions.filter(isSelectableAddressSuggestion).slice(0, 8)
    return NextResponse.json({ data: { suggestions } })
  } catch (e) {
    console.error("[geocode/autocomplete]", e)
    return NextResponse.json({ data: { suggestions: [] as AddressSuggestion[] } })
  }
}
