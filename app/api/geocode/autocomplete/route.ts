// GET /api/geocode/autocomplete?q=123+Main+St
// Returns structured address suggestions (Google Places + Details, or Nominatim addressdetails).

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  isCompleteStructuredAddress,
  structuredAddressFromGoogle,
  structuredAddressFromNominatim,
  type AddressSuggestion,
} from "@/lib/structured-address"

function googleKey(): string | null {
  return (
    process.env.GOOGLE_GEOCODING_API_KEY?.trim() ||
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    null
  )
}

async function suggestWithGoogle(query: string, key: string): Promise<AddressSuggestion[]> {
  const autoUrl = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&types=address&components=country:us&key=${key}`
  const autoRes = await fetch(autoUrl, { cache: "no-store" })
  if (!autoRes.ok) return []
  const autoData = (await autoRes.json()) as {
    predictions?: Array<{ description?: string; place_id?: string }>
  }
  const preds = (autoData.predictions ?? []).slice(0, 5)
  const out: AddressSuggestion[] = []
  for (const p of preds) {
    if (!p.place_id) continue
    const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(p.place_id)}&fields=formatted_address,address_component,geometry&key=${key}`
    const detailRes = await fetch(detailUrl, { cache: "no-store" })
    if (!detailRes.ok) continue
    const detailData = (await detailRes.json()) as {
      status?: string
      result?: Parameters<typeof structuredAddressFromGoogle>[0]
    }
    if (detailData.status !== "OK" || !detailData.result) continue
    const addr = structuredAddressFromGoogle(detailData.result)
    if (!isCompleteStructuredAddress(addr)) continue
    out.push({ ...addr, place_id: p.place_id })
  }
  return out
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

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""
  if (q.length < 3) {
    return NextResponse.json({ data: { suggestions: [] as AddressSuggestion[] } })
  }

  try {
    const key = googleKey()
    const suggestions = key ? await suggestWithGoogle(q, key) : await suggestWithNominatim(q)
    return NextResponse.json({ data: { suggestions } })
  } catch (e) {
    console.error("[geocode/autocomplete]", e)
    return NextResponse.json({ data: { suggestions: [] as AddressSuggestion[] } })
  }
}
