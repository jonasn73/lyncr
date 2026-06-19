// Spread map pins that share the same coordinates so stacked jobs remain visible.

export type LatLngPin<T> = {
  lat: number
  lng: number
  data: T
}

const EARTH_RADIUS_M = 6_371_000

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/** Haversine distance in meters between two WGS84 points. */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a))
}

/** Cluster pins whose centers are within this distance (ZIP-level geocode collisions). */
const CLUSTER_WITHIN_METERS = 400

/**
 * Group nearby pins, then spread each cluster on a ring (or row when count is small).
 */
export function spreadOverlappingPins<T>(pins: LatLngPin<T>[]): LatLngPin<T>[] {
  if (pins.length <= 1) return pins

  const clusters: LatLngPin<T>[][] = []
  const used = new Set<number>()

  for (let i = 0; i < pins.length; i++) {
    if (used.has(i)) continue
    const cluster: LatLngPin<T>[] = [pins[i]]
    used.add(i)
    for (let j = i + 1; j < pins.length; j++) {
      if (used.has(j)) continue
      const near = cluster.some(
        (c) => distanceMeters(c.lat, c.lng, pins[j].lat, pins[j].lng) <= CLUSTER_WITHIN_METERS
      )
      if (near) {
        cluster.push(pins[j])
        used.add(j)
      }
    }
    clusters.push(cluster)
  }

  const out: LatLngPin<T>[] = []
  for (const group of clusters) {
    if (group.length === 1) {
      out.push(group[0])
      continue
    }

    const centerLat = group.reduce((sum, p) => sum + p.lat, 0) / group.length
    const centerLng = group.reduce((sum, p) => sum + p.lng, 0) / group.length

    // Small groups: horizontal row (~450 m apart) reads clearly on the map.
    if (group.length <= 4) {
      const stepLng = 0.005
      const startOffset = -((group.length - 1) * stepLng) / 2
      group.forEach((pin, i) => {
        out.push({
          ...pin,
          lat: centerLat,
          lng: centerLng + startOffset + i * stepLng,
        })
      })
      continue
    }

    const radius = 0.004 + group.length * 0.0005
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

/** Expand bounds so tightly-clustered pins still fit with breathing room. */
export function expandBoundsForPins(
  latLngs: Array<[number, number]>,
  minSpanMeters = 900
): Array<[number, number]> {
  if (latLngs.length <= 1) return latLngs

  let minLat = latLngs[0][0]
  let maxLat = latLngs[0][0]
  let minLng = latLngs[0][1]
  let maxLng = latLngs[0][1]
  for (const [lat, lng] of latLngs) {
    minLat = Math.min(minLat, lat)
    maxLat = Math.max(maxLat, lat)
    minLng = Math.min(minLng, lng)
    maxLng = Math.max(maxLng, lng)
  }

  const centerLat = (minLat + maxLat) / 2
  const centerLng = (minLng + maxLng) / 2
  const spanM = Math.max(
    distanceMeters(minLat, centerLng, maxLat, centerLng),
    distanceMeters(centerLat, minLng, centerLat, maxLng)
  )

  if (spanM >= minSpanMeters) return latLngs

  const padDeg = (minSpanMeters / EARTH_RADIUS_M) * (180 / Math.PI)
  return [
    ...latLngs,
    [centerLat + padDeg, centerLng + padDeg],
    [centerLat - padDeg, centerLng - padDeg],
  ]
}
