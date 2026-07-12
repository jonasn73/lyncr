// Mock dispatch routing — proximity ETAs for tech ordering (no live routing API yet).

import {
  estimateTravelMinutes,
  formatDistanceMiles,
  formatTravelMinutes,
  travelDistanceMiles,
} from "@/lib/geo"

/** Lat/lng pair for a job site or technician pin. */
export type DispatchGeoPoint = {
  lat: number
  lng: number
}

/** Result of a stubbed tech→job ETA calculation. */
export type TechETAResult = {
  /** Straight-line miles (haversine). */
  straightLineMiles: number
  /** Rough drive minutes after a road-factor scale. */
  etaMinutes: number
  /** Miles used for dynamic tech-list sorting (road-adjusted). */
  sortKeyMiles: number
  /** Compact UI label, e.g. "4.2 mi · ~12 min". */
  label: string
}

function isValidPoint(point: DispatchGeoPoint | null | undefined): point is DispatchGeoPoint {
  return (
    point != null &&
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lng) <= 180
  )
}

/**
 * Mock routing calculation wrapper — sorts / labels techs by proximity when intake lands.
 * Replace internals with a real directions API later; keep this signature stable.
 */
export function calculateTechETA(
  jobLocation: DispatchGeoPoint | null | undefined,
  techLocation: DispatchGeoPoint | null | undefined
): TechETAResult | null {
  if (!isValidPoint(jobLocation) || !isValidPoint(techLocation)) return null

  const straightLineMiles = travelDistanceMiles(jobLocation, techLocation)
  if (!Number.isFinite(straightLineMiles) || straightLineMiles < 0) return null

  const etaMinutes = estimateTravelMinutes(straightLineMiles)
  // Same road factor as estimateTravelMinutes — keep sort order aligned with ETA.
  const sortKeyMiles = straightLineMiles * 1.35

  return {
    straightLineMiles,
    etaMinutes,
    sortKeyMiles,
    label: `${formatDistanceMiles(straightLineMiles)} · ${formatTravelMinutes(etaMinutes)}`,
  }
}

/** Format a field-distance metadata row from known miles (when only one side is cached). */
export function formatFieldDistanceLabel(straightLineMiles: number): string {
  if (!Number.isFinite(straightLineMiles) || straightLineMiles < 0) return "—"
  const etaMinutes = estimateTravelMinutes(straightLineMiles)
  return `${formatDistanceMiles(straightLineMiles)} · ${formatTravelMinutes(etaMinutes)}`
}

/**
 * Sort technicians dynamically by proximity to the job site (nearest first).
 * Techs without a live pin sink to the bottom.
 */
export function sortTechsByProximityEta<T>(
  techs: readonly T[],
  jobLocation: DispatchGeoPoint | null | undefined,
  getTechLocation: (tech: T) => DispatchGeoPoint | null | undefined
): T[] {
  return [...techs].sort((a, b) => {
    const etaA = calculateTechETA(jobLocation, getTechLocation(a))
    const etaB = calculateTechETA(jobLocation, getTechLocation(b))
    if (!etaA && !etaB) return 0
    if (!etaA) return 1
    if (!etaB) return -1
    return etaA.sortKeyMiles - etaB.sortKeyMiles
  })
}
