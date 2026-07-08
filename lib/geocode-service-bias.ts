// Default map-search bias for field-service businesses — keeps autocomplete near the service area.

export type GeocodeServiceBias = {
  lat: number
  lon: number
  /** Human label for logs / debugging. */
  label: string
}

/** Louisville metro — default for 502-area workspaces when no explicit bias is passed. */
export const DEFAULT_502_SERVICE_BIAS: GeocodeServiceBias = {
  lat: 38.2527,
  lon: -85.7585,
  label: "Louisville, KY (502)",
}

/** Parse optional `lat` + `lon` query params; fall back to the 502 service area. */
export function resolveGeocodeServiceBias(
  latRaw: string | null | undefined,
  lonRaw: string | null | undefined
): GeocodeServiceBias {
  const lat = Number(latRaw)
  const lon = Number(lonRaw)
  if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    return { lat, lon, label: "client" }
  }
  return DEFAULT_502_SERVICE_BIAS
}
