import { travelDistanceMiles } from "@/lib/geo"
import type { TechLiveLocation } from "@/lib/types"

export type NearestTechMatch = {
  techUserId: string
  name: string
  miles: number
  status: string | null
}

/** Pick the closest active technician with a live GPS coordinate. */
export function findNearestTechMatch(
  jobLat: number,
  jobLng: number,
  techLocations: TechLiveLocation[]
): NearestTechMatch | null {
  let best: NearestTechMatch | null = null
  for (const tech of techLocations) {
    if (!Number.isFinite(tech.latitude) || !Number.isFinite(tech.longitude)) continue
    const miles = travelDistanceMiles(
      { lat: jobLat, lng: jobLng },
      { lat: tech.latitude, lng: tech.longitude }
    )
    if (!Number.isFinite(miles)) continue
    if (!best || miles < best.miles) {
      best = {
        techUserId: tech.tech_user_id,
        name: tech.name?.trim() || "Technician",
        miles,
        status: tech.status,
      }
    }
  }
  return best
}
