"use client"

import { useMemo } from "react"
import useSWR from "swr"
import type { ActivePipelineJob, UnassignedPoolJob } from "@/lib/types"
import { organizationQueryString } from "@/lib/workspace-organizations"
import { defaultSwrConfig } from "@/lib/swr/config"
import { swrJsonFetcher } from "@/lib/swr/fetcher"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"

type PoolResponse<T> = { data?: { jobs?: T[] } }

const EMPTY_POOL_JOBS: UnassignedPoolJob[] = []
const EMPTY_PIPELINE_JOBS: ActivePipelineJob[] = []

export function jobPoolHopperUrl(activeOrganizationId: string | null): string {
  const orgQs = organizationQueryString(activeOrganizationId)
  return `/api/owner/jobs/pool${orgQs}`
}

export function jobPoolActiveUrl(activeOrganizationId: string | null, dayKey: string): string {
  const orgQs = organizationQueryString(activeOrganizationId)
  const sep = orgQs ? "&" : "?"
  return `/api/owner/jobs/pool${orgQs}${sep}scope=active&day=${encodeURIComponent(dayKey)}`
}

/** Bust SWR caches for hopper + active pipeline lists (call after intake saves). */
export async function revalidateSchedulerJobPoolCaches(
  activeOrganizationId?: string | null
): Promise<void> {
  const { mutate: globalMutate } = await import("swr")
  const hopperUrl = jobPoolHopperUrl(activeOrganizationId ?? null)
  await globalMutate(hopperUrl, undefined, { revalidate: true })
  await globalMutate(
    (key) => typeof key === "string" && key.startsWith("/api/owner/jobs/pool") && key.includes("scope=active"),
    undefined,
    { revalidate: true }
  )
}

export function useJobPoolQuery(activeOrganizationId: string | null) {
  const url = jobPoolHopperUrl(activeOrganizationId)
  const cacheKey = persistedCacheKey("job-pool-hopper", activeOrganizationId ?? "default")

  const fallbackData = useMemo(
    () => readPersistedCache<UnassignedPoolJob[]>(cacheKey),
    [cacheKey]
  )

  const { data, error, isLoading, isValidating, mutate } = useSWR(
    url,
    (key: string) =>
      swrJsonFetcher<PoolResponse<UnassignedPoolJob>>(key).then((json) => {
        const jobs = Array.isArray(json.data?.jobs) ? json.data!.jobs! : []
        writePersistedCache(cacheKey, jobs)
        return jobs
      }),
    { ...defaultSwrConfig, fallbackData, revalidateOnFocus: false }
  )

  const hasCachedData = fallbackData !== undefined || data !== undefined
  const jobs = useMemo(
    () => data ?? fallbackData ?? EMPTY_POOL_JOBS,
    [data, fallbackData]
  )

  return {
    jobs,
    error,
    isLoading: isLoading && !hasCachedData,
    isValidating,
    mutate,
  }
}

export function useJobPoolSuspenseQuery(activeOrganizationId: string | null) {
  const url = jobPoolHopperUrl(activeOrganizationId)
  const cacheKey = persistedCacheKey("job-pool-hopper", activeOrganizationId ?? "default")
  const fallbackData = useMemo(
    () => readPersistedCache<UnassignedPoolJob[]>(cacheKey),
    [cacheKey]
  )
  const { data } = useSWR(
    url,
    (key: string) =>
      swrJsonFetcher<PoolResponse<UnassignedPoolJob>>(key).then((json) => {
        const jobs = Array.isArray(json.data?.jobs) ? json.data!.jobs! : []
        writePersistedCache(cacheKey, jobs)
        return jobs
      }),
    { ...defaultSwrConfig, fallbackData, suspense: true }
  )
  return useMemo(() => data ?? fallbackData ?? EMPTY_POOL_JOBS, [data, fallbackData])
}

export function useActivePipelineQuery(
  activeOrganizationId: string | null,
  dayKey: string,
  enabled = true
) {
  const url = enabled ? jobPoolActiveUrl(activeOrganizationId, dayKey) : null
  const cacheKey = persistedCacheKey(
    "job-pool-active",
    `${activeOrganizationId ?? "default"}:${dayKey}`
  )

  const fallbackData = useMemo(
    () => readPersistedCache<ActivePipelineJob[]>(cacheKey),
    [cacheKey]
  )

  const { data, error, isLoading, isValidating, mutate } = useSWR(
    url,
    (key: string) =>
      swrJsonFetcher<PoolResponse<ActivePipelineJob>>(key).then((json) => {
        const jobs = Array.isArray(json.data?.jobs) ? json.data!.jobs! : []
        writePersistedCache(cacheKey, jobs)
        return jobs
      }),
    { ...defaultSwrConfig, fallbackData, revalidateOnFocus: false }
  )

  const hasCachedData = fallbackData !== undefined || data !== undefined
  const jobs = useMemo(
    () => data ?? fallbackData ?? EMPTY_PIPELINE_JOBS,
    [data, fallbackData]
  )

  return {
    jobs,
    error,
    isLoading: isLoading && !hasCachedData,
    isValidating,
    mutate,
  }
}

export function useActivePipelineSuspenseQuery(
  activeOrganizationId: string | null,
  dayKey: string,
  enabled = true
) {
  const url = enabled ? jobPoolActiveUrl(activeOrganizationId, dayKey) : null
  const cacheKey = persistedCacheKey(
    "job-pool-active",
    `${activeOrganizationId ?? "default"}:${dayKey}`
  )
  const fallbackData = useMemo(
    () => readPersistedCache<ActivePipelineJob[]>(cacheKey),
    [cacheKey]
  )
  const { data } = useSWR(
    url,
    (key: string) =>
      swrJsonFetcher<PoolResponse<ActivePipelineJob>>(key).then((json) => {
        const jobs = Array.isArray(json.data?.jobs) ? json.data!.jobs! : []
        writePersistedCache(cacheKey, jobs)
        return jobs
      }),
    { ...defaultSwrConfig, fallbackData, suspense: true }
  )
  return useMemo(() => data ?? fallbackData ?? EMPTY_PIPELINE_JOBS, [data, fallbackData])
}
