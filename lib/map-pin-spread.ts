// Spread map pins that share the same coordinates so stacked jobs remain visible.

export type LatLngPin<T> = {
  lat: number
  lng: number
  data: T
}

function coordKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`
}

/**
 * When multiple jobs geocode to the same point (e.g. ZIP-only addresses),
 * nudge them into a small ring so each marker stays clickable.
 */
export function spreadOverlappingPins<T>(pins: LatLngPin<T>[]): LatLngPin<T>[] {
  if (pins.length <= 1) return pins

  const groups = new Map<string, LatLngPin<T>[]>()
  for (const pin of pins) {
    const key = coordKey(pin.lat, pin.lng)
    const list = groups.get(key) ?? []
    list.push(pin)
    groups.set(key, list)
  }

  const out: LatLngPin<T>[] = []
  for (const group of groups.values()) {
    if (group.length === 1) {
      out.push(group[0])
      continue
    }
    const centerLat = group[0].lat
    const centerLng = group[0].lng
    const radius = 0.0018 + group.length * 0.00035
    group.forEach((pin, i) => {
      const angle = (2 * Math.PI * i) / group.length - Math.PI / 2
      out.push({
        ...pin,
        lat: centerLat + radius * Math.cos(angle),
        lng: centerLng + radius * Math.sin(angle),
      })
    })
  }
  return out
}

/** Improve geocode query when hopper jobs only have a ZIP. */
export function geocodeQueryForPoolLocation(location: string | null | undefined): string | null {
  const raw = location?.trim()
  if (!raw) return null
  if (/^\d{5}(-\d{4})?$/.test(raw)) return `${raw}, Louisville, KY`
  if (raw.length <= 6 && /^\d+$/.test(raw)) return `${raw}, Louisville, KY`
  return raw
}
