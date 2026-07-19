/** Google Maps search URL for a service / job address. */
export function googleMapsSearchUrl(serviceAddress: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(serviceAddress.trim())}`
}

/**
 * Google Maps turn-by-turn directions.
 * When `from` is set, routes from the dispatcher GPS → job; otherwise opens destination only.
 */
export function googleMapsDirectionsUrl(params: {
  toLat: number
  toLng: number
  fromLat?: number | null
  fromLng?: number | null
  destinationLabel?: string | null
}): string {
  const destination =
    params.destinationLabel?.trim() ||
    `${params.toLat},${params.toLng}`
  if (
    params.fromLat != null &&
    params.fromLng != null &&
    Number.isFinite(params.fromLat) &&
    Number.isFinite(params.fromLng)
  ) {
    return (
      `https://www.google.com/maps/dir/?api=1` +
      `&origin=${encodeURIComponent(`${params.fromLat},${params.fromLng}`)}` +
      `&destination=${encodeURIComponent(destination)}`
    )
  }
  return (
    `https://www.google.com/maps/dir/?api=1` +
    `&destination=${encodeURIComponent(destination)}`
  )
}
