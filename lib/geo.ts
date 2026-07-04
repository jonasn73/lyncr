// Tiny geo helpers (no third-party services).

const EARTH_RADIUS_M = 6_371_000

/** Great-circle distance between two lat/lng points, in meters (haversine). */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Radius (meters) within which a tech is considered "arrived on site". */
export const ARRIVAL_RADIUS_METERS = 50

const METERS_PER_MILE = 1609.344

/** Convert meters to statute miles. */
export function metersToMiles(meters: number): number {
  return meters / METERS_PER_MILE
}

/** Straight-line miles between two map points (haversine). */
export function travelDistanceMiles(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): number {
  return metersToMiles(haversineMeters(from.lat, from.lng, to.lat, to.lng))
}

/** Human-readable distance for intake UI and quote line items. */
export function formatDistanceMiles(miles: number): string {
  if (!Number.isFinite(miles) || miles < 0) return "—"
  if (miles < 0.1) return "Less than 0.1 mi"
  if (miles < 10) return `${miles.toFixed(1)} mi`
  return `${Math.round(miles)} mi`
}

/** Straight-line miles are shorter than driven distance — scale for a rough ETA. */
const DISPATCH_ETA_ROAD_FACTOR = 1.35
/** Typical urban/suburban drive speed for dispatcher ETAs. */
const DISPATCH_ETA_MPH = 32

/** Estimate drive time in minutes from straight-line miles (no routing API). */
export function estimateTravelMinutes(straightLineMiles: number): number {
  if (!Number.isFinite(straightLineMiles) || straightLineMiles <= 0) return 0
  const roadMiles = straightLineMiles * DISPATCH_ETA_ROAD_FACTOR
  return Math.max(1, Math.round((roadMiles / DISPATCH_ETA_MPH) * 60))
}

/** Human-readable ETA for intake travel preview. */
export function formatTravelMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "—"
  if (minutes === 1) return "~1 min"
  return `~${minutes} min`
}
