// Server-side driving directions — Google Directions when keyed, OSRM fallback.

import type { GeoPoint } from "@/lib/geocode"

export type LatLngTuple = [number, number]

function googleDirectionsKey(): string | null {
  return (
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.GOOGLE_GEOCODING_API_KEY?.trim() ||
    null
  )
}

/** Decode Google encoded polyline to Leaflet [lat, lng] pairs. */
function decodeGooglePolyline(encoded: string): LatLngTuple[] {
  const out: LatLngTuple[] = []
  let index = 0
  let lat = 0
  let lng = 0
  while (index < encoded.length) {
    let shift = 0
    let result = 0
    let byte: number
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1
    lat += dlat
    shift = 0
    result = 0
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1
    lng += dlng
    out.push([lat / 1e5, lng / 1e5])
  }
  return out
}

async function routeWithGoogle(from: GeoPoint, to: GeoPoint, key: string): Promise<LatLngTuple[] | null> {
  const origin = `${from.lat},${from.lng}`
  const destination = `${to.lat},${to.lng}`
  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&key=${encodeURIComponent(key)}`
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) return null
  const data = (await res.json()) as {
    status?: string
    routes?: Array<{ overview_polyline?: { points?: string } }>
  }
  const encoded = data.routes?.[0]?.overview_polyline?.points
  if (data.status !== "OK" || !encoded) return null
  return decodeGooglePolyline(encoded)
}

async function routeWithOsrm(from: GeoPoint, to: GeoPoint): Promise<LatLngTuple[] | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "lyncr/1.0 (dispatch routing; support@getzingapp.com)" },
  })
  if (!res.ok) return null
  const data = (await res.json()) as {
    code?: string
    routes?: Array<{ geometry?: { coordinates?: [number, number][] } }>
  }
  const coords = data.routes?.[0]?.geometry?.coordinates
  if (data.code !== "Ok" || !coords?.length) return null
  return coords.map(([lng, lat]) => [lat, lng] as LatLngTuple)
}

/** Fetch street-following driving geometry between two points (Leaflet lat/lng order). */
export async function fetchDrivingRoute(from: GeoPoint, to: GeoPoint): Promise<LatLngTuple[] | null> {
  if (
    !Number.isFinite(from.lat) ||
    !Number.isFinite(from.lng) ||
    !Number.isFinite(to.lat) ||
    !Number.isFinite(to.lng)
  ) {
    return null
  }
  try {
    const key = googleDirectionsKey()
    if (key) {
      const google = await routeWithGoogle(from, to, key)
      if (google?.length) return google
    }
    return await routeWithOsrm(from, to)
  } catch (e) {
    console.error("[driving-route]", e)
    return null
  }
}
