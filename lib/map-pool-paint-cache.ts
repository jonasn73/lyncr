/**
 * Compact Map Job Pool seed for hard-refresh SSR.
 * Keep enough fields that JobPoolCard / Map list don’t grow layout on live fetch.
 */

import type { UnassignedPoolJob } from "@/lib/types"
import {
  paintSeedCookieName,
  readPaintSeedCookie,
  readPaintSeedCookieValue,
  writePaintSeedCookie,
  clearPaintSeedCookie,
} from "@/lib/paint-seed-cookie"
import { operationsPaintMatchesOrg } from "@/lib/operations-paint-cache"
import { resolveStablePlaceLine } from "@/lib/settled-paint"

export const MAP_POOL_PAINT_SCOPE = "map-pool-v3"
export const MAP_POOL_PAINT_COOKIE = paintSeedCookieName(MAP_POOL_PAINT_SCOPE)

export type MapPoolPaintRow = {
  id: string
  n: string
  pl: string
  lat: number | null
  lng: number | null
  /** Customer phone — keeps the phone row from popping in after fetch. */
  ph?: string
  /** Job type / service label. */
  sv?: string
  /** Vehicle short label. */
  vh?: string
  /** Quoted price cents (optional). */
  pc?: number
  /** created_at ISO (24) — keeps ASAP/age priority shell stable on paint. */
  ca?: string
  /** scheduled_at ISO (24) — keeps schedule window priority stable on paint. */
  sa?: string
}

export type MapPoolPaintSeed = {
  organizationId: string | null
  jobs: MapPoolPaintRow[]
}

/** Fewer jobs so uncut streets fit the paint cookie. */
const MAX_PAINT_JOBS = 4
/** Full street lines (must include a digit) — no city-only stubs. */
const PLACE_CHARS = 120

function clip(s: string, n: number): string {
  const t = String(s || "")
  return t.length > n ? t.slice(0, n) : t
}

/** Street-like place only — city-only labels caused Louisville → full address flashes. */
function streetPlaceLine(job: UnassignedPoolJob): string {
  const place =
    resolveStablePlaceLine({
      location: job.location,
      neighborhood: job.neighborhood,
      region: job.region,
    }) || ""
  if (!place || !/\d/.test(place)) return ""
  return clip(place, PLACE_CHARS)
}

function placeIndexKey(organizationId: string | null | undefined): string {
  return `lyncr:map-pool-places:v1:${organizationId ?? "default"}`
}

function getLocalStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null
    return localStorage
  } catch {
    return null
  }
}

/** Persist full streets by job id (survives session TTL; fills cookie gaps). */
export function writeMapPoolPlaceIndex(
  jobs: UnassignedPoolJob[],
  organizationId: string | null = null
): void {
  const storage = getLocalStorage()
  if (!storage) return
  try {
    const prev = readMapPoolPlaceIndex(organizationId)
    const next: Record<string, string> = { ...prev }
    for (const job of jobs) {
      const place = streetPlaceLine(job)
      if (place) next[job.id] = place
    }
    // Cap index size — keep newest painted ids.
    const ids = Object.keys(next)
    if (ids.length > 80) {
      const keep = new Set(jobs.map((j) => j.id))
      for (const id of ids) {
        if (!keep.has(id) && Object.keys(next).length > 80) delete next[id]
      }
    }
    storage.setItem(placeIndexKey(organizationId), JSON.stringify(next))
  } catch {
    /* quota / private mode */
  }
}

export function readMapPoolPlaceIndex(
  organizationId?: string | null
): Record<string, string> {
  const storage = getLocalStorage()
  if (!storage) return {}
  try {
    const raw = storage.getItem(placeIndexKey(organizationId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, string>
    if (!parsed || typeof parsed !== "object") return {}
    return parsed
  } catch {
    return {}
  }
}

function trimJob(job: UnassignedPoolJob): MapPoolPaintRow {
  const title =
    (job.customer_name ?? "").trim() || (job.summary ?? "").trim() || "Open job"
  const place = streetPlaceLine(job)
  const vehicle = [job.vehicle_year, job.vehicle_make, job.vehicle_model]
    .filter(Boolean)
    .join(" ")
    .trim()
  const phone = (job.customer_phone ?? "").trim()
  const service = (job.job_type ?? "").trim()
  const price =
    typeof job.quoted_price_cents === "number" && job.quoted_price_cents > 0
      ? job.quoted_price_cents
      : undefined
  const created = job.created_at ? new Date(job.created_at) : null
  const scheduled = job.scheduled_at ? new Date(job.scheduled_at) : null
  const ca =
    created && !Number.isNaN(created.getTime()) ? clip(created.toISOString(), 24) : undefined
  const sa =
    scheduled && !Number.isNaN(scheduled.getTime())
      ? clip(scheduled.toISOString(), 24)
      : undefined
  return {
    id: clip(job.id, 40),
    n: clip(title, 48),
    // Uncut street when we have one — blank only when unknown (card reserves space).
    pl: place,
    lat: typeof job.latitude === "number" ? job.latitude : null,
    lng: typeof job.longitude === "number" ? job.longitude : null,
    ...(phone ? { ph: clip(phone, 16) } : {}),
    ...(service ? { sv: clip(service, 44) } : {}),
    ...(vehicle ? { vh: clip(vehicle, 32) } : {}),
    ...(price != null ? { pc: price } : {}),
    ...(ca ? { ca } : {}),
    ...(sa ? { sa } : {}),
  }
}

/** Expand paint rows into hopper jobs (other fields empty until live fetch). */
export function mapPoolPaintToJobs(
  seed: MapPoolPaintSeed,
  placeIndex?: Record<string, string> | null
): UnassignedPoolJob[] {
  const places = placeIndex ?? {}
  return seed.jobs.map((row) => {
    const vehicleParts = String(row.vh || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
    const year = vehicleParts[0] && /^\d{4}$/.test(vehicleParts[0]) ? vehicleParts[0] : null
    const make = year ? vehicleParts[1] ?? null : vehicleParts[0] ?? null
    const model = year
      ? vehicleParts.slice(2).join(" ") || null
      : vehicleParts.slice(1).join(" ") || null
    const cookiePlace = String(row.pl || "").trim()
    // Only trust digit streets from cookie (old v2 seeds had clipped cities / blanks).
    const fromCookie = cookiePlace && /\d/.test(cookiePlace) ? cookiePlace : ""
    const fromIndex = String(places[row.id] || "").trim()
    const location =
      (fromCookie && fromIndex
        ? fromCookie.length >= fromIndex.length
          ? fromCookie
          : fromIndex
        : fromCookie || fromIndex) || null
    return {
      id: row.id,
      customer_name: row.n,
      customer_phone: row.ph ?? null,
      location,
      neighborhood: null,
      summary: row.n,
      job_type: row.sv ?? null,
      vehicle_year: year,
      vehicle_make: make,
      vehicle_model: model,
      job_notes: null,
      scheduled_at: row.sa || null,
      duration_minutes: 60,
      dispatch_status: "UNASSIGNED",
      created_at: row.ca || "",
      latitude: row.lat,
      longitude: row.lng,
      quoted_price_cents: row.pc ?? null,
    }
  })
}

export function writeMapPoolPaintSeed(
  jobs: UnassignedPoolJob[],
  organizationId: string | null = null
): void {
  writeMapPoolPlaceIndex(jobs, organizationId)
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

export function clearMapPoolPaintSeed(): void {
  clearPaintSeedCookie(MAP_POOL_PAINT_SCOPE)
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
