// GET /api/geocode/place-details?place_id=... — structured address from Google Place ID

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { structuredAddressFromGoogle } from "@/lib/structured-address"

function googleKey(): string | null {
  return (
    process.env.GOOGLE_GEOCODING_API_KEY?.trim() ||
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    null
  )
}

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const placeId = req.nextUrl.searchParams.get("place_id")?.trim() ?? ""
  if (!placeId) return NextResponse.json({ error: "place_id is required" }, { status: 400 })

  const key = googleKey()
  if (!key) return NextResponse.json({ error: "Google Places not configured" }, { status: 503 })

  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=formatted_address,address_component,geometry&key=${key}`
    const res = await fetch(url, { cache: "no-store" })
    if (!res.ok) return NextResponse.json({ error: "Place lookup failed" }, { status: 502 })
    const data = (await res.json()) as {
      status?: string
      result?: {
        formatted_address?: string
        geometry?: { location?: { lat?: number; lng?: number } }
        address_components?: Array<{ long_name?: string; short_name?: string; types?: string[] }>
      }
    }
    if (data.status !== "OK" || !data.result) {
      return NextResponse.json({ error: "Place not found" }, { status: 404 })
    }
    const address = structuredAddressFromGoogle(data.result)
    return NextResponse.json({ data: { address } })
  } catch (e) {
    console.error("[geocode/place-details]", e)
    return NextResponse.json({ error: "Place lookup failed" }, { status: 500 })
  }
}
