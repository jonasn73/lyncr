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

function orgQuery(organizationId: string | null | undefined): string {
  if (organizationId && !organizationId.startsWith("legacy-")) {
    return `?organization_id=${encodeURIComponent(organizationId)}&scope=hopper`
  }
  return "?scope=hopper"
}

/** Stable SWR key for the single Dispatch Map page. */
export function dispatchMapDataKey(organizationId: string | null | undefined): string {
  const org =
    organizationId && !organizationId.startsWith("legacy-") ? organizationId : "all"
  return `/dispatch-map-data?org=${org}`
}

async function fetchDispatchMapData(
  organizationId: string | null | undefined
): Promise<DispatchMapData> {
  const [bookedJson, poolJson, leadsJson] = await Promise.all([
    // Active booked / assigned field jobs (+ tech GPS roster).
    fetch("/api/owner/jobs?scope=map", { credentials: "include", cache: "no-store" })
      .then((r) =>
        r.ok ? r.json() : { data: { jobs: [], technicians: [], techLocations: [] } }
      )
      .catch(() => ({ data: { jobs: [], technicians: [], techLocations: [] } })),
    // Open hopper only (BOOKED + unassigned_pool) — excludes CRM quote leads.
    fetch(`/api/owner/jobs/pool${orgQuery(organizationId)}`, {
      credentials: "include",
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : { data: { jobs: [] } }))
      .catch(() => ({ data: { jobs: [] } })),
    // Optional "Show Leads" layer — quote / callback pins with coords.
    fetch("/api/owner/jobs?scope=leads", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { data: { jobs: [] } }))
      .catch(() => ({ data: { jobs: [] } })),
  ])

  const booked = Array.isArray(bookedJson.data?.jobs)
    ? (bookedJson.data.jobs as DispatchJob[])
    : []
  const pool = Array.isArray(poolJson.data?.jobs)
    ? (poolJson.data.jobs as UnassignedPoolJob[])
    : []
  const leadJobs = Array.isArray(leadsJson.data?.jobs)
    ? (leadsJson.data.jobs as DispatchJob[])
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

/** One shared poll for the Dispatch Map page. */
export function useDispatchMapData(organizationId: string | null | undefined) {
  return useSWR(
    dispatchMapDataKey(organizationId),
    () => fetchDispatchMapData(organizationId),
    {
      refreshInterval: 25_000,
      revalidateOnFocus: true,
      keepPreviousData: true,
    }
  )
}
