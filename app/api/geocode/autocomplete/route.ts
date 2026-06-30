// GET /api/geocode/autocomplete?q=123+Main+St
// Returns structured address suggestions (Google Places, Photon OSM, or Nominatim).

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  isCompleteStructuredAddress,
  isSelectableAddressSuggestion,
  structuredAddressFromGoogle,
  structuredAddressFromNominatim,
  structuredAddressFromPhoton,
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
async function suggestWithGoogle(query: string, key: string): Promise<AddressSuggestion[]> {
  const autoUrl = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&types=address&components=country:us&key=${key}`
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

/** Photon (Komoot) — strong US partial-address matching without an API key. */
async function suggestWithPhoton(query: string): Promise<AddressSuggestion[]> {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=8&lang=en&bbox=-125,24,-66,50`
  const res = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  })
  if (!res.ok) return []
  const data = (await res.json()) as {
    features?: Array<Parameters<typeof structuredAddressFromPhoton>[0]>
  }
  return (data.features ?? [])
    .map((f) => structuredAddressFromPhoton(f))
    .filter((addr) => isCompleteStructuredAddress(addr))
}

async function suggestWithNominatim(query: string): Promise<AddressSuggestion[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=8&addressdetails=1&countrycodes=us&q=${encodeURIComponent(query)}`
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "lyncr/1.0 (address autocomplete; support@getzingapp.com)" },
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
  return merged.sort((a, b) => scoreLocalSuggestion(b, q) - scoreLocalSuggestion(a, q))
}

/** Prefer in-area matches (502 / Louisville) over distant Photon hits. */
function scoreLocalSuggestion(s: AddressSuggestion, q: string): number {
  let score = 0
  const blob = `${s.formatted} ${s.locality} ${s.admin_area} ${s.postal_code}`.toLowerCase()
  if (blob.includes("kentucky") || blob.includes(" ky ")) score += 25
  if (blob.includes("louisville") || blob.startsWith("40")) score += 20
  if (/^\d/.test(q) && s.street_number) score += 10
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

  try {
    const key = googleKey()
    const [googleResults, photonResults, nominatimResults] = await Promise.all([
      key ? suggestWithGoogle(q, key) : Promise.resolve([]),
      suggestWithPhoton(q),
      suggestWithNominatim(q),
    ])
    let suggestions = mergeSuggestions([photonResults, googleResults, nominatimResults], q)
    suggestions = suggestions.filter(isSelectableAddressSuggestion).slice(0, 8)
    return NextResponse.json({ data: { suggestions } })
  } catch (e) {
    console.error("[geocode/autocomplete]", e)
    return NextResponse.json({ data: { suggestions: [] as AddressSuggestion[] } })
  }
}
