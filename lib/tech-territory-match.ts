// Geographic matching for tech assignment recommendations.

import { travelDistanceMiles } from "@/lib/geo"
import { resolvePoolJobPostalCode } from "@/lib/job-pool-display"
import type { ActivePipelineJob, FieldTechnician, TechLiveLocation, UnassignedPoolJob } from "@/lib/types"

export type JobGeoContext = {
  postalCode: string
  city: string
  region: string
  lat: number | null
  lng: number | null
}

/** Pull ZIP / city / region tokens from a scheduler job row. */
export function jobGeoContextFromJob(
  job: UnassignedPoolJob | ActivePipelineJob | { location?: string | null; postal_code?: string | null; region?: string | null; latitude?: number | null; longitude?: number | null }
): JobGeoContext {
  const postalCode = resolvePoolJobPostalCode(job as UnassignedPoolJob).trim()
  const region = (job.region ?? "").trim()
  const location = (job.location ?? "").trim()
  let city = ""
  if (location) {
    const parts = location.split(",").map((p) => p.trim()).filter(Boolean)
    if (parts.length >= 2) {
      city = parts[parts.length - 2] ?? ""
    } else if (parts.length === 1) {
      city = parts[0] ?? ""
    }
  }
  return {
    postalCode,
    city: city.toLowerCase(),
    region: region.toLowerCase(),
    lat: job.latitude ?? null,
    lng: job.longitude ?? null,
  }
}

function normalizeToken(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase()
}

/** Score how well a technician matches the job geography (higher = better). */
export function scoreTechTerritoryMatch(params: {
  techUserId: string
  jobGeo: JobGeoContext
  assignedJobs: ActivePipelineJob[]
  techLive?: TechLiveLocation | null
  /** Optional territory hints (future DB column / roster notes). */
  primaryServiceZips?: string[] | null
  primaryServiceCities?: string[] | null
}): number {
  let score = 0
  const techId = params.techUserId.trim()
  if (!techId) return 0

  const zip = normalizeToken(params.jobGeo.postalCode)
  const city = normalizeToken(params.jobGeo.city)
  const region = normalizeToken(params.jobGeo.region)

  for (const zipHint of params.primaryServiceZips ?? []) {
    if (zip && normalizeToken(zipHint) === zip) score += 5
  }
  for (const cityHint of params.primaryServiceCities ?? []) {
    if (city && normalizeToken(cityHint) === city) score += 4
  }

  for (const assigned of params.assignedJobs) {
    if ((assigned.assigned_tech_id ?? "").trim() !== techId) continue
    const assignedGeo = jobGeoContextFromJob(assigned)
    if (zip && assignedGeo.postalCode && normalizeToken(assignedGeo.postalCode) === zip) score += 3
    if (region && assignedGeo.region && assignedGeo.region === region) score += 2
    if (city && assignedGeo.city && assignedGeo.city === city) score += 2
  }

  if (
    params.jobGeo.lat != null &&
    params.jobGeo.lng != null &&
    params.techLive?.latitude != null &&
    params.techLive?.longitude != null
  ) {
    const miles = travelDistanceMiles(
      { lat: params.techLive.latitude, lng: params.techLive.longitude },
      { lat: params.jobGeo.lat, lng: params.jobGeo.lng }
    )
    if (Number.isFinite(miles)) {
      if (miles <= 8) score += 6
      else if (miles <= 15) score += 4
      else if (miles <= 25) score += 2
    }
  }

  return score
}

/** Pick the single best geographic match for the job (null when no signal). */
export function pickBestMatchTechUserId(params: {
  technicians: FieldTechnician[]
  jobGeo: JobGeoContext
  assignedJobs: ActivePipelineJob[]
  techLiveLocations: TechLiveLocation[]
}): string | null {
  const liveById = new Map(params.techLiveLocations.map((row) => [row.tech_user_id, row]))
  let bestId: string | null = null
  let bestScore = 0

  for (const tech of params.technicians) {
    const techUserId = tech.portal_user_id?.trim()
    if (!techUserId || !tech.is_active) continue
    const score = scoreTechTerritoryMatch({
      techUserId,
      jobGeo: params.jobGeo,
      assignedJobs: params.assignedJobs,
      techLive: liveById.get(techUserId) ?? null,
    })
    if (score > bestScore) {
      bestScore = score
      bestId = techUserId
    }
  }

  return bestScore > 0 ? bestId : null
}
