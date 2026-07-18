/** Google Maps search URL for a service / job address. */
export function googleMapsSearchUrl(serviceAddress: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(serviceAddress.trim())}`
}
