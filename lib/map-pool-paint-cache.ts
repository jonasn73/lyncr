/**
 * Compact Map Job Pool seed for hard-refresh SSR.
 * Full hopper JSON is too big — keep id / name / place / pin only.
 */

import type { UnassignedPoolJob } from "@/lib/types"
import {
  paintSeedCookieName,
  readPaintSeedCookie,
  readPaintSeedCookieValue,
  writePaintSeedCookie,
} from "@/lib/paint-seed-cookie"
import { operationsPaintMatchesOrg } from "@/lib/operations-paint-cache"

export const MAP_POOL_PAINT_SCOPE = "map-pool"
export const MAP_POOL_PAINT_COOKIE = paintSeedCookieName(MAP_POOL_PAINT_SCOPE)

export type MapPoolPaintRow = {
  id: string
  n: string
  pl: string
  lat: number | null
  lng: number | null
}

export type MapPoolPaintSeed = {
  organizationId: string | null
  jobs: MapPoolPaintRow[]
}

const MAX_PAINT_JOBS = 6

function clip(s: string, n: number): string {
  const t = String(s || "")
  return t.length > n ? t.slice(0, n) : t
}

function trimJob(job: UnassignedPoolJob): MapPoolPaintRow {
  const title =
    (job.customer_name ?? "").trim() || (job.summary ?? "").trim() || "Open job"
  const place =
    (job.neighborhood ?? "").trim() || (job.location ?? "").trim() || ""
  return {
    id: clip(job.id, 40),
    n: clip(title, 28),
    pl: clip(place, 32),
    lat: typeof job.latitude === "number" ? job.latitude : null,
    lng: typeof job.longitude === "number" ? job.longitude : null,
  }
}

/** Expand paint rows into hopper jobs (other fields empty until live fetch). */
export function mapPoolPaintToJobs(seed: MapPoolPaintSeed): UnassignedPoolJob[] {
  return seed.jobs.map((row) => ({
    id: row.id,
    customer_name: row.n,
    customer_phone: null,
    location: row.pl || null,
    neighborhood: row.pl || null,
    summary: row.n,
    job_type: null,
    vehicle_year: null,
    vehicle_make: null,
    vehicle_model: null,
    job_notes: null,
    scheduled_at: null,
    duration_minutes: 60,
    dispatch_status: "UNASSIGNED",
    created_at: "",
    latitude: row.lat,
    longitude: row.lng,
  }))
}

export function writeMapPoolPaintSeed(
  jobs: UnassignedPoolJob[],
  organizationId: string | null = null
): void {
  let n = Math.min(MAX_PAINT_JOBS, Math.max(0, jobs.length))
  while (n >= 0) {
    const payload: MapPoolPaintSeed = {
      organizationId,
      jobs: jobs.slice(0, n).map(trimJob),
    }
    if (writePaintSeedCookie(MAP_POOL_PAINT_SCOPE, payload)) return
    n -= 1
  }
}

export function readMapPoolPaintFromCookieRaw(
  cookieRaw: string | null | undefined
): MapPoolPaintSeed | null {
  const parsed = readPaintSeedCookieValue<MapPoolPaintSeed>(cookieRaw)
  if (!parsed || !Array.isArray(parsed.jobs)) return null
  return parsed
}

export function readMapPoolPaintSeed(
  paint?: MapPoolPaintSeed | null,
  organizationId?: string | null
): MapPoolPaintSeed | null {
  const fromPaint = paint && Array.isArray(paint.jobs) ? paint : null
  const parsed = fromPaint ?? readPaintSeedCookie<MapPoolPaintSeed>(MAP_POOL_PAINT_SCOPE) ?? null
  if (!parsed || !Array.isArray(parsed.jobs)) return null
  if (
    organizationId !== undefined &&
    !operationsPaintMatchesOrg(
      { organizationId: parsed.organizationId, calls: [], fetchedAt: 0 },
      organizationId
    )
  ) {
    return null
  }
  return parsed
}
