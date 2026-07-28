"use client"

// Shared SWR feed for the unified Dispatch Map tab.

import useSWR from "swr"
import type { DispatchJob, FieldTechnician, TechLiveLocation, UnassignedPoolJob } from "@/lib/types"
import { mergeDispatchMapJobs } from "@/lib/dispatch-map-jobs"

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

function orgQuery(organizationId: string | null | undefined): string {
  if (organizationId && !organizationId.startsWith("legacy-")) {
    return `?organization_id=${encodeURIComponent(organizationId)}&scope=hopper`
  }
  return "?scope=hopper"
}

/** Stable SWR key for the single Dispatch Map page. */
export function dispatchMapDataKey(
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

  const booked = Array.isArray(bookedJson.data?.jobs)
    ? (bookedJson.data.jobs as DispatchJob[])
    : []
  const pool = Array.isArray(poolJson.data?.jobs)
    ? (poolJson.data.jobs as UnassignedPoolJob[])
    : []
  const leadJobs =
    includeLeads && Array.isArray(leadsJson?.data?.jobs)
      ? (leadsJson!.data!.jobs as DispatchJob[])
      : []

  return {
    jobs: mergeDispatchMapJobs(booked, pool),
    leadJobs,
    techs: Array.isArray(bookedJson.data?.techLocations)
      ? (bookedJson.data.techLocations as TechLiveLocation[])
      : [],
    technicians: Array.isArray(bookedJson.data?.technicians)
      ? (bookedJson.data.technicians as FieldTechnician[])
      : [],
    ownerUserId:
      typeof bookedJson.data?.ownerUserId === "string" ? bookedJson.data.ownerUserId : null,
  }
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

  return useSWR(
    key,
    () => fetchDispatchMapData(organizationId, includeLeads),
    {
      // Poll only while enabled; SWR skips interval when key is null too.
      refreshInterval: enabled ? 25_000 : 0,
      revalidateOnFocus: enabled,
      keepPreviousData: true,
    }
  )
}
