// GET /api/owner/jobs/pool — hopper (unassigned) or active day pipeline (map dispatch)

import { after, NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  listOwnerActivePipelineJobsForDay,
  listOwnerUnassignedPoolJobs,
  setLeadCoordinates,
} from "@/lib/db"
import { geocodeAddress } from "@/lib/geocode"
import {
  poolCoordKey,
  geocodeQueryForPoolJob,
  poolJobNeedsGeocode,
} from "@/lib/map-pin-spread"
import type { ActivePipelineJob, UnassignedPoolJob } from "@/lib/types"

export const dynamic = "force-dynamic"

type PoolJobRow = UnassignedPoolJob | ActivePipelineJob

/** Persist missing pins after the response — do not block Scheduler/Map first paint. */
async function enrichPoolJobsWithGeocode(jobs: PoolJobRow[]): Promise<void> {
  const coordCounts = new Map<string, number>()
  for (const job of jobs) {
    if (job.latitude == null || job.longitude == null) continue
    const key = poolCoordKey(job.latitude, job.longitude)
    coordCounts.set(key, (coordCounts.get(key) ?? 0) + 1)
  }

  let geocoded = 0
  for (let i = 0; i < jobs.length && geocoded < 8; i++) {
    const job = jobs[i]
    const key =
      job.latitude != null && job.longitude != null
        ? poolCoordKey(job.latitude, job.longitude)
        : null
    const duplicateCoords = key != null && (coordCounts.get(key) ?? 0) > 1

    if (!poolJobNeedsGeocode(job, duplicateCoords)) continue

    const address = geocodeQueryForPoolJob(job)
    if (!address) continue

    const coords = await geocodeAddress(address)
    if (!coords) continue

    await setLeadCoordinates(job.id, coords.lat, coords.lng).catch(() => {})

    if (key) {
      coordCounts.set(key, (coordCounts.get(key) ?? 1) - 1)
      if ((coordCounts.get(key) ?? 0) <= 0) coordCounts.delete(key)
    }
    const newKey = poolCoordKey(coords.lat, coords.lng)
    coordCounts.set(newKey, (coordCounts.get(newKey) ?? 0) + 1)
    geocoded += 1
  }
}

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const organizationId = req.nextUrl.searchParams.get("organization_id")?.trim() || null
  const orgId = organizationId && !organizationId.startsWith("legacy-") ? organizationId : null
  const scope = req.nextUrl.searchParams.get("scope")?.trim() || "hopper"
  const dayKey = req.nextUrl.searchParams.get("day")?.trim() || null

  try {
    let jobs: PoolJobRow[]
    if (scope === "active" && dayKey && /^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
      jobs = await listOwnerActivePipelineJobsForDay({
        ownerUserId: userId,
        dayKey,
        organizationId: orgId,
      })
    } else {
      jobs = await listOwnerUnassignedPoolJobs({
        ownerUserId: userId,
        organizationId: orgId,
      })
    }

    // Geocode in the background so hopper/map responses stay fast.
    after(() => {
      void enrichPoolJobsWithGeocode(jobs).catch((e) => {
        console.warn("[GET /api/owner/jobs/pool] background geocode:", e)
      })
    })

    return NextResponse.json({
      data: { jobs, scope: scope === "active" ? "active" : "hopper" },
    })
  } catch (e) {
    console.error("[GET /api/owner/jobs/pool]", e)
    return NextResponse.json({ data: { jobs: [], scope: "hopper" }, degraded: true })
  }
}
