"use client"

// Shared SWR feed for the unified Dispatch Map tab.

import { useMemo } from "react"
import useSWR from "swr"
import type { DispatchJob, FieldTechnician, TechLiveLocation, UnassignedPoolJob } from "@/lib/types"
import { mergeDispatchMapJobs, poolJobToDispatchJob } from "@/lib/dispatch-map-jobs"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"
import { useSessionCacheReady } from "@/components/session-cache-hydration-gate"
import { useDashboardPaintSeeds } from "@/lib/dashboard-paint-seeds"
import {
  mapPoolPaintToJobs,
  readMapPoolPaintSeed,
  readMapPoolPlaceIndex,
} from "@/lib/map-pool-paint-cache"

export type DispatchMapData = {
  jobs: DispatchJob[]
  /** CRM quote / callback leads with coordinates (optional layer). */
  leadJobs: DispatchJob[]
  techs: TechLiveLocation[]
  technicians: FieldTechnician[]
  ownerUserId: string | null
}

export type UseDispatchMapDataOptions = {
  /** Pause SWR when Map pane / browser tab is hidden. Default true. */
  enabled?: boolean
  /** Fetch optional lead pins only when the Leads layer is on. Default false. */
  includeLeads?: boolean
}

const EMPTY_MAP_DATA: DispatchMapData = {
  jobs: [],
  leadJobs: [],
  techs: [],
  technicians: [],
  ownerUserId: null,
}

function orgQuery(organizationId: string | null | undefined): string {
  if (organizationId && !organizationId.startsWith("legacy-")) {
    return `?organization_id=${encodeURIComponent(organizationId)}&scope=hopper`
  }
  return "?scope=hopper"
}

function mapDataCacheKey(
  organizationId: string | null | undefined,
  includeLeads: boolean
): string {
  const org =
    organizationId && !organizationId.startsWith("legacy-") ? organizationId : "all"
  return persistedCacheKey("dispatch-map-data", `${org}:leads-${includeLeads ? 1 : 0}`)
}

/** Stable SWR key for the single Dispatch Map page. */
function dispatchMapDataKey(
  organizationId: string | null | undefined,
  includeLeads = false
): string {
  const org =
    organizationId && !organizationId.startsWith("legacy-") ? organizationId : "all"
  return `/dispatch-map-data?org=${org}&leads=${includeLeads ? "1" : "0"}`
}

async function fetchDispatchMapData(
  organizationId: string | null | undefined,
  includeLeads: boolean
): Promise<DispatchMapData> {
  // Active booked / hopper jobs always; lead pins only when the layer is toggled on.
  const fetches: Promise<unknown>[] = [
    fetch("/api/owner/jobs?scope=map", { credentials: "include", cache: "no-store" })
      .then((r) =>
        r.ok ? r.json() : { data: { jobs: [], technicians: [], techLocations: [] } }
      )
      .catch(() => ({ data: { jobs: [], technicians: [], techLocations: [] } })),
    fetch(`/api/owner/jobs/pool${orgQuery(organizationId)}`, {
      credentials: "include",
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : { data: { jobs: [] } }))
      .catch(() => ({ data: { jobs: [] } })),
  ]
  if (includeLeads) {
    fetches.push(
      fetch("/api/owner/jobs?scope=leads", { credentials: "include", cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { data: { jobs: [] } }))
        .catch(() => ({ data: { jobs: [] } }))
    )
  }

  const [bookedJson, poolJson, leadsJson] = (await Promise.all(fetches)) as [
    {
      data?: {
        jobs?: DispatchJob[]
        techLocations?: TechLiveLocation[]
        technicians?: FieldTechnician[]
        ownerUserId?: string
      }
    },
    { data?: { jobs?: UnassignedPoolJob[] } },
    { data?: { jobs?: DispatchJob[] } } | undefined,
  ]

  const bookedJobs = Array.isArray(bookedJson.data?.jobs) ? bookedJson.data!.jobs! : []
  const poolJobs = Array.isArray(poolJson.data?.jobs) ? poolJson.data!.jobs! : []
  const leadJobs = includeLeads && Array.isArray(leadsJson?.data?.jobs) ? leadsJson!.data!.jobs! : []

  const next: DispatchMapData = {
    jobs: mergeDispatchMapJobs(bookedJobs, poolJobs),
    leadJobs,
    techs: Array.isArray(bookedJson.data?.techLocations) ? bookedJson.data!.techLocations! : [],
    technicians: Array.isArray(bookedJson.data?.technicians) ? bookedJson.data!.technicians! : [],
    ownerUserId:
      typeof bookedJson.data?.ownerUserId === "string" ? bookedJson.data.ownerUserId : null,
  }
  writePersistedCache(mapDataCacheKey(organizationId, includeLeads), next)
  return next
}

/** Slim paint → map jobs when session map cache is still empty. */
function mapJobsFromPoolPaint(
  organizationId: string | null | undefined,
  paintRaw: ReturnType<typeof useDashboardPaintSeeds>["mapPool"]
): DispatchJob[] {
  const seed = readMapPoolPaintSeed(paintRaw, organizationId ?? null)
  if (!seed?.jobs.length) return []
  const places = readMapPoolPlaceIndex(organizationId ?? null)
  return mapPoolPaintToJobs(seed, places)
    .map((job) => poolJobToDispatchJob(job))
    .filter((job): job is DispatchJob => job != null)
}

/** One shared poll for the Dispatch Map page — paused when the pane/tab is hidden. */
export function useDispatchMapData(
  organizationId: string | null | undefined,
  options?: UseDispatchMapDataOptions
) {
  const enabled = options?.enabled !== false
  const includeLeads = Boolean(options?.includeLeads)
  // Null key pauses the subscription without clearing other tabs' caches.
  const key = enabled ? dispatchMapDataKey(organizationId, includeLeads) : null
  const cacheKey = mapDataCacheKey(organizationId, includeLeads)
  const sessionReady = useSessionCacheReady()
  const paintJobs = useDashboardPaintSeeds().mapPool

  const fallbackData = useMemo(() => {
    const fromSession = readPersistedCache<DispatchMapData>(cacheKey)
    if (fromSession && (fromSession.jobs?.length || fromSession.techs?.length)) {
      return fromSession
    }
    const paintedJobs = mapJobsFromPoolPaint(organizationId, paintJobs)
    if (paintedJobs.length > 0) {
      return {
        ...EMPTY_MAP_DATA,
        ...(fromSession ?? {}),
        jobs: paintedJobs,
      }
    }
    return fromSession
  }, [cacheKey, organizationId, paintJobs, sessionReady])

  return useSWR(
    key,
    () => fetchDispatchMapData(organizationId, includeLeads),
    {
      // Poll only while enabled; skip focus storms (interval covers live updates).
      refreshInterval: enabled ? 25_000 : 0,
      revalidateOnFocus: false,
      keepPreviousData: true,
      fallbackData,
    }
  )
}
