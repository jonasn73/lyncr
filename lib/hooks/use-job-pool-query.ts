"use client"

import { useMemo } from "react"
import useSWR from "swr"
import type { ActivePipelineJob, UnassignedPoolJob } from "@/lib/types"
import { organizationQueryString } from "@/lib/workspace-organizations"
import { defaultSwrConfig } from "@/lib/swr/config"
import { swrJsonFetcher } from "@/lib/swr/fetcher"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"

type PoolResponse<T> = { data?: { jobs?: T[] } }

function poolHopperUrl(activeOrganizationId: string | null): string {
  const orgQs = organizationQueryString(activeOrganizationId)
  return `/api/owner/jobs/pool${orgQs}`
}

function poolActiveUrl(activeOrganizationId: string | null, dayKey: string): string {
  const orgQs = organizationQueryString(activeOrganizationId)
  const sep = orgQs ? "&" : "?"
  return `/api/owner/jobs/pool${orgQs}${sep}scope=active&day=${encodeURIComponent(dayKey)}`
}

export function useJobPoolQuery(activeOrganizationId: string | null) {
  const url = poolHopperUrl(activeOrganizationId)
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
    { ...defaultSwrConfig, fallbackData }
  )

  const hasCachedData = fallbackData !== undefined || data !== undefined
  const jobs = data ?? fallbackData ?? []

  return {
    jobs,
    error,
    isLoading: isLoading && !hasCachedData,
    isValidating,
    mutate,
  }
}

export function useActivePipelineQuery(
  activeOrganizationId: string | null,
  dayKey: string,
  enabled = true
) {
  const url = enabled ? poolActiveUrl(activeOrganizationId, dayKey) : null
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
    { ...defaultSwrConfig, fallbackData }
  )

  const hasCachedData = fallbackData !== undefined || data !== undefined
  const jobs = data ?? fallbackData ?? []

  return {
    jobs,
    error,
    isLoading: isLoading && !hasCachedData,
    isValidating,
    mutate,
  }
}
